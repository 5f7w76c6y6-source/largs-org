// functions/api/fuel-probe.js
//
// TEMPORARY reconnaissance probe for the Fuel Finder API. Not part of the
// site. Delete this file, and the FUEL_PROBE_KEY variable, once the shape
// of the read endpoints is known.
//
// It answers two questions the docs cannot:
//   1. Does Fuel Finder accept requests from Cloudflare Worker egress?
//      (adsb.fi, adsb.one and airplanes.live all refuse it — see the
//      22 August addendum. A 403 here would change the whole design.)
//   2. What do the information-recipient read endpoints accept and return?
//      The specifications list documents only the two motor-fuel-trader
//      APIs; the read side is undocumented and must be discovered.
//
// Safety: never emits the client id, client secret, access token or
// refresh token. Token-bearing values are replaced before serialising.
// Guarded by ?key= so it is not publicly callable; returns 404 without it,
// which does not advertise that the path exists.

const HOST = "https://api.fuelfinder.service.gov.uk";

// The REST overview page shows /v1/... ; the OAuth spec shows /api/v1/... .
// They contradict each other, so try both.
const TOKEN_URLS = [
  `${HOST}/api/v1/oauth/generate_secret_token`,
  `${HOST}/v1/oauth/generate_secret_token`,
];

// Guesses, in order of likelihood. Authentication docs demonstrate
// GET /v1/prices?fuel_type=unleaded, so /prices is real; everything else
// here is a hypothesis about how it can be narrowed to an area.
const PROBES = [
  `${HOST}/api/v1/prices`,
  `${HOST}/api/v1/prices?fuel_type=unleaded`,
  `${HOST}/api/v1/prices?postcode=KA30`,
  `${HOST}/api/v1/prices?latitude=55.7952&longitude=-4.8612&radius=25`,
  `${HOST}/api/v1/forecourts`,
  `${HOST}/api/v1/stations`,
  `${HOST}/v1/prices`,
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function headerMap(h) {
  const out = {};
  for (const [k, v] of h.entries()) {
    if (k.toLowerCase() === "set-cookie") continue;
    out[k] = v;
  }
  return out;
}

// Replace secret-bearing values. refresh_token_expires_in is a number and
// is deliberately kept — it is the 48-hour clock the Worker must track.
function redact(v) {
  if (Array.isArray(v)) return v.map(redact);
  if (v && typeof v === "object") {
    const o = {};
    for (const [k, val] of Object.entries(v)) {
      const secret =
        k === "access_token" || k === "refresh_token" || /secret/i.test(k);
      o[k] = secret ? "«redacted»" : redact(val);
    }
    return o;
  }
  return v;
}

// Structural outline: field names, array lengths, and short values so the
// real field names are visible without dumping a national file into a page.
function outline(v, depth = 0) {
  if (v === null) return null;
  if (Array.isArray(v)) {
    return {
      "«array»": v.length,
      first: v.length && depth < 3 ? outline(v[0], depth + 1) : undefined,
    };
  }
  if (typeof v === "object") {
    const o = {};
    for (const k of Object.keys(v).slice(0, 40)) {
      o[k] = depth < 4 ? outline(v[k], depth + 1) : typeof v[k];
    }
    return o;
  }
  if (typeof v === "string") return v.length > 80 ? `«string ${v.length}»` : v;
  return v;
}

async function probe(url, init) {
  const started = Date.now();
  let res, text;
  try {
    res = await fetch(url, init);
    text = await res.text();
  } catch (e) {
    return { url, transportError: String(e), ms: Date.now() - started };
  }
  const report = {
    url,
    status: res.status,
    ms: Date.now() - started,
    bytes: text.length,
    headers: headerMap(res.headers),
  };
  try {
    report.shape = outline(redact(JSON.parse(text)));
  } catch {
    report.notJson = text.slice(0, 400);
  }
  return report;
}

export async function onRequest({ request, env }) {
  const url = new URL(request.url);
  const expected = env.FUEL_PROBE_KEY || "";
  if (!expected || !timingSafeEqual(url.searchParams.get("key") || "", expected)) {
    return new Response("Not found", { status: 404 });
  }

  const out = { ranAt: new Date().toISOString(), token: [], data: [] };

  if (!env.FUEL_CLIENT_ID || !env.FUEL_CLIENT_SECRET) {
    out.fatal = "FUEL_CLIENT_ID and/or FUEL_CLIENT_SECRET are not set on this project.";
    return json(out);
  }

  // --- step 1: token ------------------------------------------------------
  let accessToken = null;
  for (const t of TOKEN_URLS) {
    const r = await probe(t, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        client_id: env.FUEL_CLIENT_ID,
        client_secret: env.FUEL_CLIENT_SECRET,
      }),
    });
    out.token.push(r);
    if (r.status === 200 && !r.notJson) {
      // Generate returns an envelope {success,data,message}; regenerate's
      // sample is flat. Accept either.
      const raw = await refetchToken(t, env);
      if (raw) { accessToken = raw.token; out.tokenMeta = raw.meta; break; }
    }
    await sleep(400);
  }

  if (!accessToken) {
    out.note = "No access token obtained — read probes skipped. Status codes above are the finding.";
    return json(out);
  }

  // --- step 2: read endpoints --------------------------------------------
  // Strictly serial: the guidelines allow 1 concurrent request per client
  // and return 429 on breach. No Promise.all here, ever.
  const extra = url.searchParams.get("path");
  const list = extra ? [...PROBES, `${HOST}${extra}`] : PROBES;

  for (const p of list) {
    out.data.push(
      await probe(p, {
        headers: { authorization: `Bearer ${accessToken}`, accept: "application/json" },
      })
    );
    await sleep(400);
  }

  return json(out);
}

// Fetch the token a second time to extract it without it ever passing
// through the reporting path. Slightly wasteful; keeps redaction absolute.
async function refetchToken(tokenUrl, env) {
  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      client_id: env.FUEL_CLIENT_ID,
      client_secret: env.FUEL_CLIENT_SECRET,
    }),
  });
  if (!res.ok) return null;
  let j;
  try { j = await res.json(); } catch { return null; }
  const d = j && j.data ? j.data : j;
  if (!d || !d.access_token) return null;
  return {
    token: d.access_token,
    meta: {
      envelope: Boolean(j && j.data),
      token_type: d.token_type,
      expires_in: d.expires_in,
      refresh_token_expires_in: d.refresh_token_expires_in,
      hasRefreshToken: Boolean(d.refresh_token),
    },
  };
}

function json(obj) {
  return new Response(JSON.stringify(obj, null, 2), {
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}
