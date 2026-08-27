/* largs-power: polls SP Energy Networks' National Energy Outage (NEO)
 * dataset every ten minutes and keeps a small snapshot in R2 for the
 * site to read at build time.
 *
 * Licence: the NEO and Distribution Live Outages datasets carry no
 * per-dataset licence in the portal's metadata catalogue, so the portal
 * default -- the SP Energy Networks Open Data Licence (CC BY 4.0 based)
 * -- applies. The gated Shared Data sections announce themselves on
 * their own pages; these do not. Registration message of 27 Aug 2026
 * told the portal administrator exactly this use and polling rate.
 *
 * TIMEZONE MISLABEL -- DO NOT "FIX". The feed writes local clock time
 * with a +00:00 suffix (observed twice on 27 Aug 2026: upload_date
 * stamps sat exactly one BST hour ahead of true UTC). So these strings
 * must never be timezone-converted. Times are displayed as the naked
 * clock time SPEN wrote, and staleness is judged ONLY by our own
 * fetchedAt, which this Worker sets from its own clock.
 *
 * post_code is a semicolon list of postcode SECTORS ("DG8 0;DG8 6").
 * The server-side `like` filter is a coarse cut to keep the payload
 * small; the authoritative filter is the sector-by-sector startswith
 * below. Substring "KA30" cannot false-match Kilmarnock, whose sectors
 * render as "KA3 0" -- the space breaks the run of four characters.
 */

const DATASET = "national-energy-outage-data";
const BASE = "https://spenergynetworks.opendatasoft.com/api/explore/v2.1/catalog/datasets/" + DATASET + "/records";
const OUTCODES = ["KA28", "KA29", "KA30"];
const PAGE = 100;
// A named storm crossing the Central Belt is exactly the night this must
// not fall over. The corridor filter keeps volume tiny, but cap the walk
// so a runaway response can never wedge the Worker.
const MAX_RECORDS = 500;
const KEY = "power.json";
const UA = "largs-community-site/1.0 (largs-org.pages.dev; power notices for the town; KA30)";

function sectorsOf(rec) {
  return String(rec.post_code || "")
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
}

function matchedSectors(rec) {
  return sectorsOf(rec).filter((s) => OUTCODES.some((oc) => s.startsWith(oc)));
}

function normalise(rec) {
  const mine = matchedSectors(rec);
  return {
    id: rec.fault_id || null,
    planned: rec.planned === 1,
    // Kept verbatim for the record; nothing downstream branches on it,
    // because the vocabulary is undocumented ("Awaiting" observed).
    status: rec.status || null,
    sectors: mine,
    reported: rec.date_of_reported_fault || null,
    plannedStart: rec.planned_outage_start_date || null,
    etr: rec.etr || null,
    restored: rec.date_of_restoration || null,
    voltage: rec.voltage || null,
    region: rec.region || null,
    // Display context only. The live Cheshire fault of 27 Aug carried
    // null here, so this field must never be a condition.
    localAuthority: rec.local_authority || null,
  };
}

async function fetchCorridor(env) {
  const where = "(" + OUTCODES.map((oc) => `post_code like "*${oc}*"`).join(" or ") + ")";
  const out = [];
  let offset = 0;
  for (;;) {
    const qs = new URLSearchParams({ where, limit: String(PAGE), offset: String(offset) });
    const url = BASE + "?" + qs.toString();
    const res = await fetch(url, {
      headers: {
        "Authorization": "Apikey " + env.SPEN_API_KEY,
        "Accept": "application/json",
        "User-Agent": UA,
      },
    });
    if (!res.ok) {
      const body = (await res.text()).slice(0, 200);
      const err = new Error("SPEN " + res.status);
      err.detail = { path: url.replace(/Apikey[^&]*/g, ""), status: res.status, body };
      throw err;
    }
    const json = await res.json();
    const batch = Array.isArray(json.results) ? json.results : [];
    out.push(...batch);
    offset += batch.length;
    const total = Number(json.total_count || 0);
    if (batch.length === 0 || offset >= total || offset >= MAX_RECORDS) {
      return { records: out, total, truncated: offset >= MAX_RECORDS && offset < total };
    }
  }
}

export default {
  async scheduled(_event, env, _ctx) {
    const now = new Date().toISOString();
    let prev = null;
    try {
      const old = await env.POWER_BUCKET.get(KEY);
      if (old) prev = await old.json();
    } catch { /* a corrupt snapshot must not stop a fresh one */ }

    let snap;
    try {
      const { records, total, truncated } = await fetchCorridor(env);
      const incidents = records
        .map(normalise)
        .filter((r) => r.sectors.length > 0); // the authoritative filter
      snap = {
        ok: true,
        // Our clock, at the moment of a SUCCESSFUL pull. The only basis
        // for staleness anywhere downstream -- see mislabel note above.
        fetchedAt: now,
        lastAttemptAt: now,
        lastError: prev && prev.lastError ? { cleared: now, was: prev.lastError } : null,
        // NOT a SPEN-wide count: the `where` clause is applied
        // server-side, so total_count arrives already filtered to the
        // corridor outcodes. This is "records matching KA28/29/30",
        // which is what the truncation check needs and all it means.
        matchedTotal: total,
        truncated,
        incidents,
      };
    } catch (e) {
      // Failure keeps the previous incidents and the previous fetchedAt:
      // the 30-minute staleness rule then retires them honestly, rather
      // than a blip making a real outage vanish for ten minutes.
      snap = {
        ok: prev ? prev.ok === true : false,
        fetchedAt: prev ? prev.fetchedAt || null : null,
        lastAttemptAt: now,
        lastError: {
          at: now,
          message: String(e && e.message || e),
          ...(e && e.detail ? e.detail : {}),
        },
        matchedTotal: prev ? prev.matchedTotal ?? null : null,
        truncated: prev ? Boolean(prev.truncated) : false,
        incidents: prev && Array.isArray(prev.incidents) ? prev.incidents : [],
      };
    }

    await env.POWER_BUCKET.put(KEY, JSON.stringify(snap), {
      httpMetadata: { contentType: "application/json" },
    });
  },
};
