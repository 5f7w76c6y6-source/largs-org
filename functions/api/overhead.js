// /api/overhead — live aircraft near Largs, same-origin proxy + route
// enrichment. v1.4, 19 August 2026.
//
// AIRCRAFT: browsers can't call the community ADS-B aggregators directly
// (no CORS headers — verified 18 Aug 2026), so this function fetches on
// the site's behalf, politely: one shared snapshot cached at the edge for
// 8 seconds serves every visitor (whole town ≤ ~7 upstream req/min).
//
// RESILIENCE (v1.4): the aggregators rate-limit Cloudflare's shared
// egress IPs — upstream verified healthy from residential and other
// vantages while failing via the Worker, 19 Aug. So: provider order is
// rotated per attempt; a provider that fails is rested on a cooldown
// (Retry-After honoured when sent, capped 300 s; 60 s default on
// 429/420; 20 s on other failures); and the last good snapshot now
// serves for up to TEN MINUTES, marked stale — the page already stamps
// "feed interrupted, showing last received" with the payload's own
// timestamp, so staleness is labelled, never disguised. Honest 503
// beyond that.
//
// ROUTES: adsbdb.com contract verified 19 Aug (GET /v0/callsign/{CS};
// 404 = definitive unknown, cached 6 h; transient non-200s uncached).
// Positive answers cached 24 h WITH airport coordinates, because v1.4
// adds the PLAUSIBILITY TEST the Kahului incident demanded: a route is
// attached only if the aircraft's detour — dist(plane,origin) +
// dist(plane,destination) − dist(origin,destination) — is under 400 nm.
// Calibrated against ground truth 19 Aug: UAL959 London–Chicago over
// Largs detours 63 nm (passes); the stale Kahului–Newark route detoured
// 4,499 nm (dies). Generous for weather routing, fatal for ghosts.
// Silence over guesses, always.

const UPSTREAMS = [
  "https://api.adsb.lol/v2/lat/55.795/lon/-4.87/dist/20",
  "https://opendata.adsb.fi/api/v2/lat/55.795/lon/-4.87/dist/20",
];

const ROUTE_API = "https://api.adsbdb.com/v0/callsign/";
const ROUTE_TIME_CAP_MS = 1500;
const DETOUR_ALLOW_NM = 400;

const UA =
  "largs-community-site/1.4 (volunteer town site; contact largsevents@gmail.com)";

const FRESH_KEY = new Request("https://overhead-cache.largs.internal/fresh");
const LASTGOOD_KEY = new Request("https://overhead-cache.largs.internal/last-good");

function clientResponse(body, stale) {
  return new Response(body, {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-overhead-stale": stale ? "1" : "0",
    },
  });
}

function cacheable(body, maxAge) {
  return new Response(body, {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "public, max-age=" + maxAge,
    },
  });
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
function routePlausible(alat, alon, r) {
  const via = distNm(alat, alon, r.olat, r.olon) + distNm(alat, alon, r.dlat, r.dlon);
  const direct = distNm(r.olat, r.olon, r.dlat, r.dlon);
  return via - direct <= DETOUR_ALLOW_NM;
}

// ---- provider cooldowns ----
function cooldownKey(url) {
  return new Request(
    "https://overhead-cache.largs.internal/cooldown/" + new URL(url).host
  );
}
async function onCooldown(cache, url) {
  return !!(await cache.match(cooldownKey(url)));
}
async function rest(cache, url, seconds) {
  const s = Math.max(5, Math.min(300, Math.round(seconds)));
  await cache.put(cooldownKey(url), cacheable('{"resting":true}', s));
}

// ---- route lookups (cache namespace v2: entries carry coordinates) ----
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
  const hit = await cache.match(routeCacheKey(cs));
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
  if (!r.ok && r.status !== 404) {
    return null; // transient (rate limit, 5xx): cache nothing, retry
  }
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

  const ttl = entry.none ? 21600 : 86400;
  await cache.put(routeCacheKey(cs), cacheable(JSON.stringify(entry), ttl));
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
    if (!wanted.length) return;

    const cap = new Promise((resolve) =>
      setTimeout(() => resolve("cap"), ROUTE_TIME_CAP_MS)
    );
    const lookups = Promise.all(
      wanted.map((cs) =>
        lookupRoute(cache, cs).then((r) => [cs, r]).catch(() => [cs, null])
      )
    );
    const done = await Promise.race([lookups, cap]);
    if (done === "cap") {
      // cold lookups overran the cap: let them finish and cache in the
      // background so the NEXT snapshot inherits their answers
      context.waitUntil(lookups.then(function () {}).catch(function () {}));
      return;
    }

    const routes = {};
    for (const [cs, r] of done) if (r) routes[cs] = r;
    for (const a of parsed.ac) {
      const cs = (a.flight || "").trim();
      const r = routes[cs];
      if (!r) continue;
      // the plausibility gate: route memory is cached, geometry is live
      if (typeof a.lat === "number" && typeof a.lon === "number" &&
          routePlausible(a.lat, a.lon, r)) {
        a.route = { iata: r.iata, from: r.from, to: r.to };
      }
    }
  } catch {
    // enrichment must never cost the snapshot
  }
}

export async function onRequestGet(context) {
  const cache = caches.default;

  const fresh = await cache.match(FRESH_KEY);
  if (fresh) {
    return clientResponse(await fresh.text(), false);
  }

  // rotate provider order so both share the load and neither is always
  // first into a limiter's teeth
  const order =
    Math.random() < 0.5 ? UPSTREAMS : [UPSTREAMS[1], UPSTREAMS[0]];

  for (const url of order) {
    if (await onCooldown(cache, url)) continue;
    let r;
    try {
      r = await fetch(url, { headers: { "user-agent": UA } });
    } catch {
      await rest(cache, url, 20);
      continue;
    }
    if (!r.ok) {
      if (r.status === 429 || r.status === 420) {
        const ra = parseInt(r.headers.get("retry-after") || "", 10);
        await rest(cache, url, isNaN(ra) ? 60 : ra);
      } else {
        await rest(cache, url, 20);
      }
      continue;
    }
    const raw = await r.text();
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      await rest(cache, url, 20);
      continue;
    }
    if (!parsed || !Array.isArray(parsed.ac)) {
      await rest(cache, url, 20);
      continue;
    }

    await enrichRoutes(context, cache, parsed);
    const body = JSON.stringify(parsed);

    await cache.put(FRESH_KEY, cacheable(body, 8));
    await cache.put(LASTGOOD_KEY, cacheable(body, 600));
    return clientResponse(body, false);
  }

  // upstream weather: serve the last good snapshot for up to ten
  // minutes, marked stale — the page labels its age from the payload
  const lastGood = await cache.match(LASTGOOD_KEY);
  if (lastGood) {
    return clientResponse(await lastGood.text(), true);
  }

  return new Response(JSON.stringify({ unavailable: true }), {
    status: 503,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
