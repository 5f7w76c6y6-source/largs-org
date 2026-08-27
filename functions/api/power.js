/* GET /api/power -- the corridor's power-cut snapshot, for the build.
 *
 * Same-origin, same shape of honesty as /api/fuel: reads what the cron
 * Worker keeps in R2, never talks to SPEN itself, and never throws --
 * the build must be able to call this and get a calm {ok:false} however
 * broken the world is.
 *
 * Times pass through as the raw strings SPEN wrote. Their +00:00 suffix
 * is a mislabel on local clock time (see the poller's header comment),
 * so any parsing here would manufacture a wrong answer. Staleness is
 * computed from OUR fetchedAt only.
 */

const KEY = "power.json";
const EDGE_TTL = 120;
// Three missed ten-minute polls. Past this the notice retires itself:
// showing a fault we can no longer confirm is worse than silence, and
// silence claims nothing -- SPEN's feed already omits incidents under
// five customers, so absence was never an all-clear.
const STALE_AFTER_MS = 30 * 60 * 1000;

export async function onRequestGet({ request, env }) {
  const cache = caches.default;
  const hit = await cache.match(request);
  if (hit) return hit;

  let out;
  try {
    if (!env.POWER_BUCKET) throw new Error("no POWER_BUCKET binding");
    const obj = await env.POWER_BUCKET.get(KEY);
    if (!obj) throw new Error("no snapshot yet");
    const snap = await obj.json();

    const at = Date.parse(snap.fetchedAt || "") || 0;
    const ageMs = at ? Date.now() - at : null;
    const stale = ageMs == null || ageMs > STALE_AFTER_MS;

    const incidents = Array.isArray(snap.incidents) ? snap.incidents : [];
    out = {
      ok: snap.ok === true && !stale,
      fetchedAt: snap.fetchedAt || null,
      ageSeconds: ageMs == null ? null : Math.round(ageMs / 1000),
      stale,
      truncated: Boolean(snap.truncated),
      faults: incidents.filter((i) => !i.planned && !i.restored),
      planned: incidents.filter((i) => i.planned && !i.restored),
      lastError: snap.lastError || null,
    };
  } catch (e) {
    out = { ok: false, fetchedAt: null, ageSeconds: null, stale: true,
            truncated: false, faults: [], planned: [],
            lastError: { message: String(e && e.message || e) } };
  }

  const res = new Response(JSON.stringify(out), {
    headers: {
      "content-type": "application/json",
      "cache-control": "public, max-age=" + EDGE_TTL,
    },
  });
  const copy = res.clone();
  try { await cache.put(request, copy); } catch { /* cache is best-effort */ }
  return res;
}
