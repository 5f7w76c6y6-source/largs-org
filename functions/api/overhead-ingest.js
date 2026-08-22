// /api/overhead-ingest — receives the aircraft snapshot from the Pi.
//
// WHY THIS EXISTS: the community ADS-B aggregators refuse Cloudflare
// Worker egress (verified 22 Aug 2026: adsb.fi, adsb.one,
// airplanes.live and re-api.adsb.lol all 403/503, adsb.lol 429, three
// runs, zero successes — while the same URLs answer a residential line
// every time). They are filtering datacenter IP ranges, which no
// credential can change. So the site stops pulling and starts being
// pushed to: Qubixer-1090 fetches over home broadband, where it is a
// recognised feeder, and PUTs the result here.
//
// SECURITY: a shared secret in the OVERHEAD_INGEST_KEY environment
// variable (set encrypted in the Pages dashboard, held in a 0600 file
// on the Pi, never in the repo). Body is size-capped and shape-checked
// before it is stored, so a valid key still cannot store nonsense.
//
// REQUIRES (both Pages projects, largs-org and largs-preview):
//   Settings > Bindings > R2 bucket   variable name OVERHEAD_BUCKET
//   Settings > Environment variables  OVERHEAD_INGEST_KEY (encrypted)
// Redeploy after adding either.

const OBJECT_KEY = "overhead.json";
const MAX_BODY_BYTES = 512 * 1024;

function json(status, obj) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

// length-independent-ish comparison; both values are short, and this
// avoids leaking the key one character at a time via timing
function sameKey(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function onRequestPut(context) {
  const { request, env } = context;

  const expected = env.OVERHEAD_INGEST_KEY;
  if (!expected) return json(503, { error: "ingest key not configured" });
  if (!sameKey(request.headers.get("x-overhead-key") || "", expected)) {
    return json(401, { error: "unauthorised" });
  }
  if (!env.OVERHEAD_BUCKET) {
    return json(503, { error: "bucket binding missing" });
  }

  const body = await request.text();
  if (body.length > MAX_BODY_BYTES) {
    return json(413, { error: "payload too large" });
  }

  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    return json(400, { error: "not valid JSON" });
  }
  const list = Array.isArray(parsed.ac)
    ? parsed.ac
    : Array.isArray(parsed.aircraft)
    ? parsed.aircraft
    : null;
  if (!list) return json(400, { error: "no aircraft array" });

  // stamp receipt time so the reader can tell snapshot age from delivery
  // age; the payload's own `now` still governs what the page displays
  parsed._received = Date.now();

  try {
    await env.OVERHEAD_BUCKET.put(OBJECT_KEY, JSON.stringify(parsed), {
      httpMetadata: { contentType: "application/json; charset=utf-8" },
    });
  } catch (e) {
    return json(500, { error: "store failed" });
  }

  return json(200, { ok: true, aircraft: list.length });
}

// A GET here is almost always someone poking about; say nothing useful.
export async function onRequestGet() {
  return json(405, { error: "method not allowed" });
}
