// /api/overhead — live aircraft near Largs, same-origin proxy.
//
// Browsers can't call the community ADS-B aggregators directly (no CORS
// headers — verified 18 Aug 2026), so this Pages Function fetches on the
// site's behalf. It is deliberately a polite client:
//
//   - One shared snapshot, cached at the edge for 8 seconds, serves every
//     visitor at once: the whole town costs the upstream at most ~7
//     requests a minute, however many people are watching.
//   - If the upstream rate-limits or fails (adsb.lol returned a 420 during
//     testing), the last good snapshot is served for up to 120 seconds —
//     the page shows its age honestly from the payload's own timestamp.
//   - Beyond that: 503 {"unavailable": true} and the page says so plainly.
//
// Upstreams are ADSBExchange-v2-compatible; the provider is a one-line
// swap. Data licence: ODbL (attributed on the page).
//
// Lives at repo root in functions/ — deployed automatically by the
// existing `wrangler pages deploy` step (both projects), invoked ONLY for
// /api/overhead; every other path on the site remains pure static.

const UPSTREAMS = [
  "https://api.adsb.lol/v2/lat/55.795/lon/-4.87/dist/20",
  "https://opendata.adsb.fi/api/v2/lat/55.795/lon/-4.87/dist/20",
];

const UA =
  "largs-community-site/1.0 (volunteer town site; contact largsevents@gmail.com)";

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

export async function onRequestGet(context) {
  const cache = caches.default;

  // Serve the shared snapshot if one is fresh.
  const fresh = await cache.match(FRESH_KEY);
  if (fresh) {
    return clientResponse(await fresh.text(), false);
  }

  // Otherwise fetch upstream, first provider that answers sanely wins.
  for (const url of UPSTREAMS) {
    try {
      const r = await fetch(url, { headers: { "user-agent": UA } });
      if (!r.ok) continue;
      const body = await r.text();
      let parsed;
      try {
        parsed = JSON.parse(body);
      } catch {
        continue;
      }
      if (!parsed || !Array.isArray(parsed.ac)) continue;

      await cache.put(FRESH_KEY, cacheable(body, 8));
      await cache.put(LASTGOOD_KEY, cacheable(body, 120));
      return clientResponse(body, false);
    } catch {
      // network failure — try the next provider
    }
  }

  // Upstreams down or rate-limiting: serve the last good snapshot, marked
  // stale; the payload's own `now` timestamp lets the page show its age.
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
