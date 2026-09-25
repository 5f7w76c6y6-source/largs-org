// /api/ships — vessels in the Largs Channel now. v1.0, 25 September 2026.
//
// Serves the snapshot that pi/ships.py PUTs to R2 through
// /api/ships-ingest: every vessel heard by aisstream.io's receivers
// within RADIUS_NM of Largs in the last ten minutes, as the vessels
// themselves broadcast it. Same pipeline as /api/overhead, minus the
// route and identity lookups — a ship's name, type and destination
// travel in its own AIS messages, so nothing is looked up anywhere.
//
// HONESTY: the payload carries its own `now`; the page stamps age and
// says "feed interrupted, showing last received" past 60 s. Beyond
// MAX_AGE_MS this returns 503 and the page says so plainly. Nothing is
// invented and nothing is kept: the object is overwritten every push and
// the relay forgets a vessel ten minutes after it was last heard.
//
// REQUIRES: R2 binding OVERHEAD_BUCKET on the Pages project (already
// there for the aircraft feed; this reads a second object from it).

const OBJECT_KEY = "ships.json";
const MAX_AGE_MS = 15 * 60 * 1000;
const EDGE_TTL_S = 10; // one shared read serves every visitor
const HOME_LAT = 55.795;
const HOME_LON = -4.87;
const RADIUS_NM = 15;

const FRESH_KEY = new Request("https://ships-cache.largs.internal/fresh1");

function clientResponse(body, stale, diag) {
  const h = {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-ships-stale": stale ? "1" : "0",
  };
  if (diag && diag.length) h["x-ships-diag"] = diag.join(" ");
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

// Trust the relay's distance and bearing when present, fill them when not,
// and enforce the radius here as well so the page never depends on the
// relay's own filter.
function normalise(parsed) {
  if (!Array.isArray(parsed.vessels)) return parsed;
  parsed.vessels = parsed.vessels.filter((v) => {
    if (typeof v.lat !== "number" || typeof v.lon !== "number") return false;
    if (typeof v.dst !== "number") v.dst = distNm(HOME_LAT, HOME_LON, v.lat, v.lon);
    if (typeof v.dir !== "number") v.dir = bearingDeg(HOME_LAT, HOME_LON, v.lat, v.lon);
    return v.dst <= RADIUS_NM;
  });
  parsed.vessels.sort((a, b) => a.dst - b.dst);
  return parsed;
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
  if (!Array.isArray(parsed.vessels)) return unavailable(["object:novessels"]);

  const stamped = typeof parsed.now === "number" ? parsed.now : 0;
  const age = stamped ? Date.now() - stamped : Number.MAX_SAFE_INTEGER;
  if (age > MAX_AGE_MS) {
    return unavailable(["snapshot:stale", "age:" + Math.round(age / 1000) + "s"]);
  }
  diag.push("bucket:ok", "age:" + Math.round(age / 1000) + "s");

  const body = JSON.stringify(parsed);
  try {
    await cache.put(FRESH_KEY, cacheable(body, EDGE_TTL_S));
  } catch {}
  return clientResponse(body, age > 60000, diag);
}
