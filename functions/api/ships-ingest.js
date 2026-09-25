// /api/ships-ingest — receives the vessel snapshot from the Pi.
//
// The sea-going twin of overhead-ingest.js, 25 September 2026. Qubixer-1090
// holds a WebSocket to aisstream.io (which will not accept a browser
// connection and asks you to proxy only what your clients need), keeps a
// table of vessels heard in the Largs box, and PUTs it here every 20 s
// (pi/ships.py). This stores it in R2; /api/ships serves it.
//
// DELIBERATELY NOTHING NEW TO CONFIGURE. Same shared secret as the aircraft
// relay (OVERHEAD_INGEST_KEY, header x-overhead-key, /etc/largs-overhead.key
// on the Pi) and the same bucket binding (OVERHEAD_BUCKET), a different
// object. One key for two feeds from the same machine is no weaker than one
// key for one, and it means no dashboard visit to get this live.
//
// Body is size-capped and shape-checked before it is stored, so a valid key
// still cannot store nonsense.

const OBJECT_KEY = "ships.json";
const MAX_BODY_BYTES = 256 * 1024;

function json(status, obj) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

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
  if (!Array.isArray(parsed.vessels)) return json(400, { error: "no vessels array" });
  if (typeof parsed.now !== "number") return json(400, { error: "no timestamp" });

  parsed._received = Date.now();

  try {
    await env.OVERHEAD_BUCKET.put(OBJECT_KEY, JSON.stringify(parsed), {
      httpMetadata: { contentType: "application/json; charset=utf-8" },
    });
  } catch (e) {
    return json(500, { error: "store failed" });
  }

  return json(200, { ok: true, vessels: parsed.vessels.length });
}

export async function onRequestGet() {
  return json(405, { error: "method not allowed" });
}
