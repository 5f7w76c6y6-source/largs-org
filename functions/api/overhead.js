// /api/overhead — live aircraft near Largs. v2.3, 22 August 2026.
//
// ARCHITECTURE CHANGE. v1.x fetched the community aggregators directly
// and, from 20 August, was refused: adsb.fi, adsb.one, airplanes.live
// and re-api.adsb.lol all 403/503 and adsb.lol 429, three consecutive
// runs, five providers, zero successes — while the identical URLs
// answered a residential line every time. Four independent operators
// filtering the same source is datacenter-IP reputation, not a
// credential problem, and no rotation fixes it.
//
// So the pipeline is inverted, which is the project's push-not-pull
// principle anyway: Qubixer-1090 fetches over home broadband (where it
// is a recognised feeder) and PUTs the snapshot to R2 via
// /api/overhead-ingest. This endpoint serves that object. Nobody is
// asked for anything they have refused, and the site reads from its own
// storage rather than a third party.
//
// When the Pi moves to Largs the pusher switches from relaying
// adsb.lol to publishing its own receiver's picture. Same pipeline,
// same object, better data, no change here.
//
// ROUTES are unchanged and still fetched live from adsbdb.com, which
// does answer Workers (verified in production since 19 Aug): per
// callsign, edge-cached 24 h positive / 6 h negative, 1.5 s cap, and
// gated by the detour-ellipse plausibility test so a stale route can't
// be attached to an aircraft nowhere near it.
//
// HONESTY: the payload carries its own `now`; the page stamps age and
// says "feed interrupted, showing last received" past 30 s. Beyond
// MAX_AGE_MS this returns 503 and the page says so plainly. If the Pi
// or the home line is down, the page degrades — it does not invent.
//
// REQUIRES: R2 binding OVERHEAD_BUCKET on the Pages project.

const OBJECT_KEY = "overhead.json";
const MAX_AGE_MS = 15 * 60 * 1000; // beyond this, honestly unavailable
const EDGE_TTL_S = 5; // one shared read serves every visitor
const HOME_LAT = 55.795;
const HOME_LON = -4.87;
const RADIUS_NM = 30; // whole of Arran (farthest point 24 nm) with margin

const ROUTE_API = "https://api.adsbdb.com/v0/callsign/";
// Aircraft identity, keyed on the Mode S hex — which every aircraft
// broadcasts, unlike callsign or type code. Contract verified 22 Aug:
// GET /v0/aircraft/{hex} -> {response:{aircraft:{registered_owner,
// manufacturer, type, icao_type, …}}}, 404 = definitive unknown.
// Ownership rarely changes, so this is cached far longer than routes.
// (The response also carries url_photo / url_photo_thumbnail from
// airport-data.com. Deliberately unused: those are someone else's
// photographs under their own terms, and that is a separate decision.)
const AIRCRAFT_API = "https://api.adsbdb.com/v0/aircraft/";
const LOOKUP_TIME_CAP_MS = 2000;
const DETOUR_ALLOW_NM = 400;

const UA =
  "largs-community-site/2.3 (volunteer town site; contact largsevents@gmail.com)";

const FRESH_KEY = new Request("https://overhead-cache.largs.internal/fresh2");

function clientResponse(body, stale, diag) {
  const h = {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-overhead-stale": stale ? "1" : "0",
  };
  if (diag && diag.length) h["x-overhead-diag"] = diag.join(" ");
  return new Response(body, { status: 200, headers: h });
}

function cacheable(body, maxAge) {
  return new Response(body, {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "public, max-age=" + maxAge,
    },
  });
}

function unavailable(diag) {
  return new Response(
    JSON.stringify({ unavailable: true, diag: diag, at: Date.now() }),
    {
      status: 503,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
      },
    }
  );
}

// ---- geometry (nautical miles, spherical) ----
function toRad(d) { return (d * Math.PI) / 180; }
function distNm(la1, lo1, la2, lo2) {
  const f1 = toRad(la1), f2 = toRad(la2);
  const df = toRad(la2 - la1), dl = toRad(lo2 - lo1);
  const a =
    Math.sin(df / 2) * Math.sin(df / 2) +
    Math.cos(f1) * Math.cos(f2) * Math.sin(dl / 2) * Math.sin(dl / 2);
  return 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) * 3440.065;
}
function bearingDeg(la1, lo1, la2, lo2) {
  const f1 = toRad(la1), f2 = toRad(la2), dl = toRad(lo2 - lo1);
  const y = Math.sin(dl) * Math.cos(f2);
  const x = Math.cos(f1) * Math.sin(f2) - Math.sin(f1) * Math.cos(f2) * Math.cos(dl);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}
function routePlausible(alat, alon, r) {
  const via = distNm(alat, alon, r.olat, r.olon) + distNm(alat, alon, r.dlat, r.dlon);
  const direct = distNm(r.olat, r.olon, r.dlat, r.dlon);
  return via - direct <= DETOUR_ALLOW_NM;
}

// Accept either dialect and fill anything missing, so the pusher can one
// day switch from relaying adsb.lol to publishing the Pi's own readsb
// output without this endpoint changing.
function normalise(parsed) {
  if (!Array.isArray(parsed.ac) && Array.isArray(parsed.aircraft)) {
    parsed.ac = parsed.aircraft;
  }
  if (typeof parsed.now === "number" && parsed.now < 1e12) {
    parsed.now = Math.round(parsed.now * 1000);
  }
  if (!Array.isArray(parsed.ac)) return parsed;
  parsed.ac = parsed.ac.filter((a) => {
    if (typeof a.lat !== "number" || typeof a.lon !== "number") return true;
    if (typeof a.dst !== "number") a.dst = distNm(HOME_LAT, HOME_LON, a.lat, a.lon);
    if (typeof a.dir !== "number") a.dir = bearingDeg(HOME_LAT, HOME_LON, a.lat, a.lon);
    return a.dst <= RADIUS_NM;
  });
  return parsed;
}

// ---- route lookups (unchanged from v1.4.1) ----
function shedSuffixes(name) {
  return String(name || "")
    .replace(/\s+Airport$/i, "")
    .replace(/\s+International$/i, "")
    .trim();
}
function routeCacheKey(cs) {
  return new Request(
    "https://overhead-cache.largs.internal/route2/" + encodeURIComponent(cs)
  );
}

async function lookupRoute(cache, cs) {
  let hit = null;
  try {
    hit = await cache.match(routeCacheKey(cs));
  } catch {}
  if (hit) {
    try {
      const j = await hit.json();
      return j && j.iata ? j : null;
    } catch {
      return null;
    }
  }

  let r;
  try {
    r = await fetch(ROUTE_API + encodeURIComponent(cs), {
      headers: { "user-agent": UA },
    });
  } catch {
    return null; // network trouble: cache nothing, retry next snapshot
  }
  if (!r.ok && r.status !== 404) return null; // transient: do not cache

  let entry = { none: true }; // 404 lands here: a definitive "unknown"
  if (r.ok) {
    try {
      const j = await r.json();
      const fr = j && j.response && j.response.flightroute;
      const o = fr && fr.origin;
      const d = fr && fr.destination;
      if (
        o && d && o.iata_code && d.iata_code &&
        typeof o.latitude === "number" && typeof o.longitude === "number" &&
        typeof d.latitude === "number" && typeof d.longitude === "number"
      ) {
        entry = {
          iata: o.iata_code + "-" + d.iata_code,
          from: shedSuffixes(o.name) || o.iata_code,
          to: shedSuffixes(d.name) || d.iata_code,
          olat: o.latitude, olon: o.longitude,
          dlat: d.latitude, dlon: d.longitude,
        };
      }
    } catch {
      return null; // malformed body: treat as transient
    }
  }

  try {
    await cache.put(
      routeCacheKey(cs),
      cacheable(JSON.stringify(entry), entry.none ? 21600 : 86400)
    );
  } catch {}
  return entry.none ? null : entry;
}

function aircraftCacheKey(hex) {
  return new Request(
    "https://overhead-cache.largs.internal/aircraft1/" + encodeURIComponent(hex)
  );
}

async function lookupAircraft(cache, hex) {
  let hit = null;
  try {
    hit = await cache.match(aircraftCacheKey(hex));
  } catch {}
  if (hit) {
    try {
      const j = await hit.json();
      return j && j.owner ? j : null;
    } catch {
      return null;
    }
  }

  let r;
  try {
    r = await fetch(AIRCRAFT_API + encodeURIComponent(hex), {
      headers: { "user-agent": UA },
    });
  } catch {
    return null;
  }
  if (!r.ok && r.status !== 404) return null; // transient: do not cache

  let entry = { none: true };
  if (r.ok) {
    try {
      const j = await r.json();
      const ac = j && j.response && j.response.aircraft;
      if (ac && (ac.registered_owner || ac.type)) {
        const model = [ac.manufacturer, ac.type].filter(Boolean).join(" ").trim();
        entry = {
          owner: ac.registered_owner || "",
          model: model,
          reg: ac.registration || ""
        };
        if (!entry.owner) delete entry.owner;
      }
    } catch {
      return null;
    }
  }

  try {
    await cache.put(
      aircraftCacheKey(hex),
      // 7 days for a known aircraft, 24 h for an unknown one
      cacheable(JSON.stringify(entry), entry.none ? 86400 : 604800)
    );
  } catch {}
  return entry.none ? null : entry;
}

async function enrichRoutes(context, cache, parsed) {
  try {
    const wanted = [];
    const seen = {};
    for (const a of parsed.ac) {
      const cs = (a.flight || "").trim();
      if (/^[A-Z]{2,3}\d/.test(cs) && !seen[cs]) {
        seen[cs] = true;
        wanted.push(cs);
      }
    }


    // aircraft identities, keyed on hex — every aircraft has one
    const hexes = [];
    const seenHex = {};
    for (const a of parsed.ac) {
      if (a.hex && !seenHex[a.hex]) {
        seenHex[a.hex] = true;
        hexes.push(a.hex);
      }
    }

    const cap = new Promise((resolve) =>
      setTimeout(() => resolve("cap"), LOOKUP_TIME_CAP_MS)
    );
    const lookups = Promise.all([
      Promise.all(
        wanted.map((cs) =>
          lookupRoute(cache, cs).then((r) => [cs, r]).catch(() => [cs, null])
        )
      ),
      Promise.all(
        hexes.map((h) =>
          lookupAircraft(cache, h).then((r) => [h, r]).catch(() => [h, null])
        )
      )
    ]);
    const done = await Promise.race([lookups, cap]);
    if (done === "cap") {
      context.waitUntil(lookups.then(function () {}).catch(function () {}));
      return;
    }

    const routes = {};
    for (const [cs, r] of done[0]) if (r) routes[cs] = r;
    const idents = {};
    for (const [h, r] of done[1]) if (r) idents[h] = r;

    for (const a of parsed.ac) {
      if (idents[a.hex]) a.ident = idents[a.hex];
      const cs = (a.flight || "").trim();
      const r = routes[cs];
      if (!r) continue;
      if (
        typeof a.lat === "number" && typeof a.lon === "number" &&
        routePlausible(a.lat, a.lon, r)
      ) {
        a.route = { iata: r.iata, from: r.from, to: r.to };
      }
    }
  } catch {
    // enrichment must never cost the snapshot
  }
}

export async function onRequestGet(context) {
  const { env } = context;
  const cache = caches.default;
  const diag = [];

  let fresh = null;
  try {
    fresh = await cache.match(FRESH_KEY);
  } catch {}
  if (fresh) {
    const body = await fresh.text();
    let age = 0;
    try {
      const p = JSON.parse(body);
      age = p && typeof p.now === "number" ? Date.now() - p.now : 0;
    } catch {}
    return clientResponse(body, age > 60000, ["cache:hit"]);
  }

  if (!env.OVERHEAD_BUCKET) {
    return unavailable(["bucket:unbound"]);
  }

  let obj = null;
  try {
    obj = await env.OVERHEAD_BUCKET.get(OBJECT_KEY);
  } catch {
    return unavailable(["bucket:error"]);
  }
  if (!obj) return unavailable(["bucket:empty"]);

  let parsed;
  try {
    parsed = JSON.parse(await obj.text());
  } catch {
    return unavailable(["object:badjson"]);
  }
  normalise(parsed);
  if (!Array.isArray(parsed.ac)) return unavailable(["object:noac"]);

  const stamped = typeof parsed.now === "number" ? parsed.now : 0;
  const age = stamped ? Date.now() - stamped : Number.MAX_SAFE_INTEGER;
  if (age > MAX_AGE_MS) {
    return unavailable(["snapshot:stale", "age:" + Math.round(age / 1000) + "s"]);
  }
  diag.push("bucket:ok", "age:" + Math.round(age / 1000) + "s");

  await enrichRoutes(context, cache, parsed);
  const body = JSON.stringify(parsed);

  try {
    await cache.put(FRESH_KEY, cacheable(body, EDGE_TTL_S));
  } catch {
    // serve it even if the edge cache refuses
  }
  return clientResponse(body, age > 60000, diag);
}
