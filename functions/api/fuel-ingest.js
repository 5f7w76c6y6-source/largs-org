/* PUT /api/fuel-ingest — receives the corridor snapshot from Qubixer-1090.
 *
 * The poller runs on the Pi because scheduled Cloudflare egress cannot
 * reliably reach Fuel Finder's WAF: four 403 outages in twenty-six hours,
 * always on the token mint, always ending only when a human intervened.
 * Residential egress has never been refused.
 *
 * Same shape as overhead-ingest: a shared key in a header, no R2
 * credentials on the Pi, nothing accepted from anywhere else.
 */

const KEY = "corridor.json";

export async function onRequestPut({ request, env }) {
  const given = request.headers.get("x-fuel-key") || "";
  const want = env.FUEL_INGEST_KEY || "";
  // 404 rather than 401: an endpoint that denies you is an endpoint you
  // know exists.
  if (!want || given !== want) return new Response("Not found", { status: 404 });
  if (!env.FUEL_BUCKET) return new Response("no bucket binding", { status: 500 });

  let body;
  try {
    body = await request.json();
  } catch {
    return new Response("not json", { status: 400 });
  }

  // Refuse anything that is not a complete corridor. The poller never sends
  // a partial one, but a half-written snapshot in R2 is what made the site
  // show two forecourts as though they were all of them, so the receiver
  // checks rather than trusts.
  if (!body || body.ok !== true || !Array.isArray(body.stations)
      || body.stations.length === 0 || body.syncing) {
    return new Response("incomplete snapshot refused", { status: 400 });
  }

  await env.FUEL_BUCKET.put(KEY, JSON.stringify(body), {
    httpMetadata: { contentType: "application/json" },
  });
  return new Response(JSON.stringify({ ok: true, count: body.stations.length }), {
    headers: { "content-type": "application/json" },
  });
}
