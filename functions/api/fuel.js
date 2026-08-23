/* GET /api/fuel — the live price overlay for /fuel/.
 *
 * Same-origin, so the page needs no CORS and no third-party host appears in
 * the network tab. Reads the snapshot the cron Worker keeps in R2; it never
 * talks to Fuel Finder itself, because a page request cannot wait for a
 * serial walk of the register.
 *
 * PRICES ONLY, deliberately. The bucket holds the register's own forecourt
 * records -- names, addresses, coordinates, amenities -- and serving those
 * back out would be redistributing raw API data, which the Fuel Finder
 * developer guidelines ask integrators not to do. So this emits a small
 * derived object of our own shape: node_id -> grade -> price and the moment
 * it became effective. The names and places are already in the page, baked
 * at build time from the same snapshot.
 *
 * That also keeps the payload to a few kilobytes rather than forty.
 */

const KEY = "corridor.json";

/* Under the five minutes the fair use policy asks for, with room to spare.
 * The whole town shares one cached copy, so a busy afternoon costs the same
 * as a quiet one. */
const EDGE_TTL = 120;

/* The Worker runs every five minutes. Past this, something has stopped --
 * a cron that did not fire, an outage at the register, an expired refresh
 * token -- and the page should say so rather than present old numbers as
 * current. Generous enough to ride out one or two missed ticks. */
const STALE_AFTER_MS = 25 * 60 * 1000;

export async function onRequestGet({ request, env, waitUntil }) {
  const cache = caches.default;
  const hit = await cache.match(request);
  if (hit) return hit;

  let out;
  try {
    if (!env.FUEL_BUCKET) throw new Error("no FUEL_BUCKET binding");
    const obj = await env.FUEL_BUCKET.get(KEY);
    if (!obj) throw new Error("no snapshot yet");

    const snap = await obj.json();
    const at = Date.parse(snap.fetchedAt || "") || 0;
    const ageMs = at ? Date.now() - at : null;

    const prices = {};
    for (const s of snap.stations || []) {
      const byGrade = {};
      for (const f of s.fuel_prices || []) {
        if (!f.fuel_type || f.price == null) continue;
        byGrade[f.fuel_type] = {
          p: f.price,
          // The EFFECTIVE timestamp, not price_last_updated: the question a
          // driver has is when the price became true at the pump, not when
          // the record was written.
          at: f.price_change_effective_timestamp || f.price_last_updated || null,
        };
      }
      if (Object.keys(byGrade).length) prices[s.node_id] = byGrade;
    }

    out = {
      ok: true,
      fetchedAt: snap.fetchedAt || null,
      ageSeconds: ageMs == null ? null : Math.round(ageMs / 1000),
      // Honest staleness rather than silence: the page shows the numbers it
      // has and says plainly that they have stopped being refreshed.
      stale: ageMs != null && ageMs > STALE_AFTER_MS,
      syncing: Boolean(snap.syncing),
      count: Object.keys(prices).length,
      prices,
    };
  } catch (e) {
    // Degrade, never guess. The page keeps its directory and says the prices
    // are unavailable -- which is true, and better than a plausible number.
    out = { ok: false, reason: String(e && e.message || e), prices: {} };
  }

  const res = new Response(JSON.stringify(out), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": out.ok
        ? `public, max-age=30, s-maxage=${EDGE_TTL}`
        : "no-store",
    },
  });

  if (out.ok) waitUntil(cache.put(request, res.clone()));
  return res;
}
