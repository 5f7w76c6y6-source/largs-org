// /api/overhead — live aircraft near Largs, same-origin proxy + route
// enrichment. v1.2, 19 August 2026.
//
// AIRCRAFT: browsers can't call the community ADS-B aggregators directly
// (no CORS headers — verified 18 Aug 2026), so this function fetches on
// the site's behalf, politely: one shared snapshot cached at the edge for
// 8 seconds serves every visitor (whole town ≤ ~7 upstream req/min);
// last-good served up to 120 s on failure, marked stale; honest 503
// beyond. adsb.lol threw a 420 in testing — the cache is the manners.
//
// ROUTES: contract verified 19 Aug 2026 against adsbdb.com —
//   GET https://api.adsbdb.com/v0/callsign/{CS}
//   200 → {response:{flightroute:{origin:{name,municipality,iata_code,…},
//                                 destination:{…}, airline:{…}}}}
//   unknown callsign → {response:"unknown callsign"}
// (adsb.lol's own routeset answered 201-empty and its spec 404s — dead
// end; hexdb.io answers ICAO pairs and is held in reserve, unwired.)
// Each airline-shaped callsign is looked up once and cached 24 h
// (negatives 6 h); lookups run in parallel with a hard time cap and any
// failure simply means that aircraft carries no route. Enrichment happens
// BEFORE the snapshot is cached, so all visitors share the answers.
//
// Attached per aircraft:  route: { iata: "LHR-GLA",
//                                  from: "London Heathrow",
//                                  to:   "Glasgow" }
// Names are adsbdb's with " Airport" / " International" suffixes shed —
// plain English for the cards; the IATA pair feeds the map popups.

const UPSTREAMS = [
  "https://api.adsb.lol/v2/lat/55.795/lon/-4.87/dist/20",
  "https://opendata.adsb.fi/api/v2/lat/55.795/lon/-4.87/dist/20",
];

const ROUTE_API = "https://api.adsbdb.com/v0/callsign/";
const ROUTE_TIME_CAP_MS = 1500;

const UA =
  "largs-community-site/1.2 (volunteer town site; contact largsevents@gmail.com)";

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

function shedSuffixes(name) {
  return String(name || "")
    .replace(/\s+Airport$/i, "")
    .replace(/\s+International$/i, "")
    .trim();
}

function routeCacheKey(cs) {
  return new Request(
    "https://overhead-cache.largs.internal/route/" + encodeURIComponent(cs)
  );
}

async function lookupRoute(cache, cs) {
  // cache first — positive and negative answers both live here
  const hit = await cache.match(routeCacheKey(cs));
  if (hit) {
    try {
      const j = await hit.json();
      return j && j.iata ? j : null;
    } catch {
      return null;
    }
  }

  let entry = { none: true };
  try {
    const r = await fetch(ROUTE_API + encodeURIComponent(cs), {
      headers: { "user-agent": UA },
    });
    if (r.ok) {
      const j = await r.json();
      const fr = j && j.response && j.response.flightroute;
      const o = fr && fr.origin;
      const d = fr && fr.destination;
      if (o && d && o.iata_code && d.iata_code) {
        entry = {
          iata: o.iata_code + "-" + d.iata_code,
          from: shedSuffixes(o.name) || o.iata_code,
          to: shedSuffixes(d.name) || d.iata_code,
        };
      }
    }
  } catch {
    // network trouble: cache nothing, try again next snapshot
    return null;
  }

  const ttl = entry.none ? 21600 : 86400;
  await cache.put(routeCacheKey(cs), cacheable(JSON.stringify(entry), ttl));
  return entry.none ? null : entry;
}

async function enrichRoutes(cache, parsed) {
  try {
    const wanted = [];
    const seen = {};
    for (const a of parsed.ac) {
      const cs = (a.flight || "").trim();
      // airline-shaped callsigns only: 2–3 letters then digits
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
    if (done === "cap") return; // cold lookups overran — next snapshot wins

    const routes = {};
    for (const [cs, r] of done) if (r) routes[cs] = r;
    for (const a of parsed.ac) {
      const cs = (a.flight || "").trim();
      if (routes[cs]) a.route = routes[cs];
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

  for (const url of UPSTREAMS) {
    try {
      const r = await fetch(url, { headers: { "user-agent": UA } });
      if (!r.ok) continue;
      const raw = await r.text();
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch {
        continue;
      }
      if (!parsed || !Array.isArray(parsed.ac)) continue;

      await enrichRoutes(cache, parsed);
      const body = JSON.stringify(parsed);

      await cache.put(FRESH_KEY, cacheable(body, 8));
      await cache.put(LASTGOOD_KEY, cacheable(body, 120));
      return clientResponse(body, false);
    } catch {
      // network failure — try the next provider
    }
  }

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
