/* largs.org — Fuel Finder poller.
 *
 * Runs on a cron trigger every five minutes, keeps a picture of the
 * forecourts inside the Largs box in R2, and writes a snapshot the site can
 * read. Nothing here does any naming: the locality table, the brand tidying,
 * the street-name rule and the sorting all live in scripts/make-fuel.py, and
 * a second implementation of those rules in JavaScript would drift from it.
 * So the snapshot deliberately carries the REGISTER'S OWN records, in the
 * same shape as the 23 August recon pull that make-fuel.py already reads.
 *
 * Why incremental
 * ---------------
 * A full national pull is 8,037 forecourts across 17 batches, about 6 MB.
 * Every five minutes that would be 1.7 GB a day pulled from a government
 * service to serve 26 forecourts in Ayrshire. The register's own increment
 * endpoint answers "what changed today" instead: measured 23 August at
 * 11:20, that was 98 records in a single batch, 68 KB.
 *
 * The catch, and it shapes everything below: `effective-start-timestamp` is
 * typed <date>, not a timestamp. The finest question available is "since
 * midnight", never "since 11:15". So a price set at 23:58 lands in
 * YESTERDAY's increment and is invisible to today's. The nightly full
 * re-sync is therefore load-bearing, not belt-and-braces.
 *
 * Why the work is rationed
 * ------------------------
 * A full sync is 34 serial calls -- one concurrent request per client is all
 * the guidelines allow -- and parsing 6 MB of JSON in one invocation is a lot
 * of CPU for a scheduled Worker. So a full sync is RESUMABLE: a few batches
 * per tick, progress stored in R2, finishing over an hour or so of ticks. No
 * invocation ever does much, and a failure costs one batch rather than the
 * whole pass.
 */

const HOST = "https://www.fuel-finder.service.gov.uk";

/* Fuel Finder sits behind AWS WAF, which 403s any request with no
 * User-Agent, and Workers send none unless told. Proven 22 August with
 * identical curls: 403 with the header stripped, 400 without. */
const UA = "largs-community-site/1.0 (+https://largs-org.pages.dev)";

/* The corridor. THIS IS NOW THE ONLY DEFINITION OF THE BOX.
 * It was first drawn in ~/Developer/fuel-recon/ff-pull.py for the 23 August
 * pull; that script is history. make-fuel.py never had it -- it reads an
 * already-filtered file -- so there is no second copy to drift from.
 *
 * The WEST edge is a FERRY boundary, not a distance boundary. Dunoon sits
 * near -4.93 and is a Western Ferries crossing away; an earlier -4.95 cut let
 * it in, which would have listed an unreachable forecourt as if you could
 * drive to it. Do not round this off without re-testing that PA23, Millport
 * and Rothesay all stay out. */
const LAT_MIN = 55.58, LAT_MAX = 55.97;
const LON_MIN = -4.91, LON_MAX = -4.60;

const MAX_FETCHES_PER_TICK = 3;   // rationing; see header
const BATCH_FULL = 500;           // a short batch means the walk is over
const FULL_SYNC_AFTER_MS = 20 * 60 * 60 * 1000;

const K_TOKEN = "token.json";
const K_STATE = "state.json";
const K_SNAP  = "corridor.json";

/* ------------------------------------------------------------------ */
/* Tokens                                                              */
/* ------------------------------------------------------------------ */

/* Workers keep nothing between cron invocations, so a token minted at 09:00
 * is gone by 09:05. Minting 288 a day is exactly what the service's own
 * guidance asks developers not to do, so the token is cached in R2.
 *
 * That does mean a bearer token at rest in the bucket. The bucket is private
 * and already holds the same trust level as the client secret in this
 * Worker's environment, but it is a real thing and worth knowing about.
 *
 * Access token lives 1 hour, refresh token 48. The refresh response does NOT
 * hand back a new refresh token, so the 48-hour clock runs from the original
 * exchange and never resets -- an implementation that only watches
 * expires_in works for two days and then starts failing with 400. */
async function getToken(env) {
  const now = Date.now();
  let t = null;
  try {
    const o = await env.FUEL.get(K_TOKEN);
    if (o) t = await o.json();
  } catch { /* treat an unreadable cache as no cache */ }

  if (t && t.access_expires > now + 120_000) return t.access_token;

  // Refresh while the refresh token has life in it, otherwise start over.
  if (t && t.refresh_token && t.refresh_expires > now + 60_000) {
    const r = await post("/api/v1/oauth/regenerate_access_token", {
      client_id: env.FUEL_CLIENT_ID,
      refresh_token: t.refresh_token,
    });
    if (r) {
      const next = {
        access_token: r.access_token,
        access_expires: now + (r.expires_in || 3600) * 1000,
        // Carried forward unchanged: regenerate does not reissue it.
        refresh_token: t.refresh_token,
        refresh_expires: t.refresh_expires,
      };
      await env.FUEL.put(K_TOKEN, JSON.stringify(next));
      return next.access_token;
    }
  }

  const r = await post("/api/v1/oauth/generate_access_token", {
    client_id: env.FUEL_CLIENT_ID,
    client_secret: env.FUEL_CLIENT_SECRET,
  });
  if (!r) throw new Error(lastPostError || "could not obtain an access token");

  const fresh = {
    access_token: r.access_token,
    access_expires: now + (r.expires_in || 3600) * 1000,
    refresh_token: r.refresh_token || null,
    refresh_expires: now + (r.refresh_token_expires_in || 172800) * 1000,
  };
  await env.FUEL.put(K_TOKEN, JSON.stringify(fresh));
  return fresh.access_token;
}

/* The OAuth responses arrive wrapped -- {success, data:{...}, message} on
 * generate, flat on regenerate. Unwrap defensively rather than assuming
 * either. The read endpoints, confusingly, return a bare array. */
let lastPostError = null;

async function post(path, body) {
  const res = await fetch(HOST + path, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json", "user-agent": UA },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    // The status used to be thrown away, which left ten hours of failure
    // reading only "could not obtain an access token". A 403 is the WAF, a
    // 401 is the credentials, a 5xx is their end — very different problems,
    // and the first 200 characters of the body usually say which.
    let body = "";
    try { body = (await res.text()).slice(0, 200); } catch { /* ignore */ }
    lastPostError = `${path} -> ${res.status} ${body.replace(/\s+/g, " ")}`;
    return null;
  }
  let j;
  try { j = await res.json(); } catch { return null; }
  const d = j && j.data ? j.data : j;
  return d && d.access_token ? d : null;
}

async function getBatch(token, path) {
  const res = await fetch(HOST + path, {
    headers: { authorization: `Bearer ${token}`, accept: "application/json", "user-agent": UA },
  });
  if (res.status === 404) return { done: true, rows: [] };   // walked past the end
  if (!res.ok) return { error: res.status, rows: [] };
  const rows = await res.json();
  return Array.isArray(rows) ? { rows } : { error: "not an array", rows: [] };
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function inBox(r) {
  const l = r && r.location;
  if (!l) return false;
  const { latitude: la, longitude: lo } = l;
  return typeof la === "number" && typeof lo === "number"
    && la >= LAT_MIN && la <= LAT_MAX && lo >= LON_MIN && lo <= LON_MAX;
}

/* Largs wall-clock date. The register's increment filter is a calendar date,
 * and GitHub and Cloudflare both run UTC -- which is an hour behind for half
 * the year, so "today" computed naively would ask for yesterday all evening
 * through the summer. Same discipline as the date filters in
 * eleventy.config.js. */
function ukToday(d = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(d);
}

const emptyState = () => ({
  schema: 1,
  day: null,
  lastFull: 0,
  changedAt: null,
  sync: null,        // { phase: "info"|"prices", batch: n }
  stations: {},      // node_id -> the register's forecourt record
  prices: {},        // node_id -> its fuel_prices array
  lastError: null,
});

async function load(env, key, fallback) {
  try {
    const o = await env.FUEL.get(key);
    if (o) return await o.json();
  } catch { /* fall through */ }
  return fallback;
}

/* The snapshot. Same shape as the 23 August recon pull, so make-fuel.py
 * reads it unchanged: an array of forecourt records with fuel_prices merged
 * in. Metadata rides alongside rather than inside, so the array stays clean. */
function buildSnapshot(state) {
  const stations = Object.keys(state.stations).map((id) => ({
    ...state.stations[id],
    fuel_prices: state.prices[id] || [],
  }));
  return {
    ok: true,
    schema: 1,
    // TWO clocks, and they answer different questions.
    //   checkedAt — when the Worker last asked the register. Written every
    //     tick, changed or not. This is what "is the site still working"
    //     depends on.
    //   changedAt — when a price at one of OUR forecourts last moved. On a
    //     quiet Sunday this can be hours old and nothing is wrong.
    // Conflating them (an earlier version wrote only fetchedAt, and only
    // when something changed) makes a working site look broken the moment
    // the town goes quiet.
    checkedAt: new Date().toISOString(),
    changedAt: state.changedAt || null,
    day: state.day,
    lastFull: state.lastFull ? new Date(state.lastFull).toISOString() : null,
    syncing: Boolean(state.sync),
    count: stations.length,
    stations,
  };
}

/* ------------------------------------------------------------------ */
/* One tick                                                            */
/* ------------------------------------------------------------------ */

async function tick(env) {
  const state = await load(env, K_STATE, emptyState());
  const today = ukToday();
  const log = [];
  let fetches = 0;
  // Cleared each tick: a transient 502 from three hours ago should not still
  // be showing in status. It is set again below if this tick also fails.
  state.lastError = null;
  let changed = false;

  /* State is loaded BEFORE the token, and a token failure is recorded rather
   * than thrown. It used to throw straight out of tick() -- before any state
   * was loaded or written -- so nothing was recorded at all: the status
   * endpoint kept showing the previous tick's error against a frozen
   * checkedAt, which is indistinguishable from a cron that has stopped
   * firing. That cost nine hours of silent failure on 23 August, after the
   * WAF rate-limited us for a burst of manual ticks.
   *
   * The SNAPSHOT is deliberately not written here. Its checkedAt means "when
   * we last successfully read the register", and moving it on a failed
   * attempt would make the page say "Prices as at 20:52" over figures from
   * lunchtime. Leaving it stale is what makes the page say "not refreshing"
   * -- which is the only reason this was noticed at all. */
  let token;
  try {
    token = await getToken(env);
  } catch (e) {
    state.lastError = `token: ${(e && e.message) || e}`;
    state.checkedAt = new Date().toISOString();
    await env.FUEL.put(K_STATE, JSON.stringify(state));
    return { at: state.checkedAt, fetches: 0, lastError: state.lastError,
             note: "no token — snapshot left alone so the page stays honest" };
  }

  const needFull =
    !state.sync &&
    (Object.keys(state.stations).length === 0 ||
     Date.now() - (state.lastFull || 0) > FULL_SYNC_AFTER_MS);

  if (needFull) {
    state.sync = { phase: "info", batch: 1, seen: 0 };
    log.push("full sync started");
  }

  /* ---- resumable full sync ------------------------------------- */
  while (state.sync && fetches < MAX_FETCHES_PER_TICK) {
    const s = state.sync;
    const path = s.phase === "info"
      ? `/api/v1/pfs?batch-number=${s.batch}`
      : `/api/v1/pfs/fuel-prices?batch-number=${s.batch}`;

    const { rows, done, error } = await getBatch(token, path);
    fetches++;
    if (error) { state.lastError = `${s.phase} batch ${s.batch}: ${error}`; break; }

    if (s.phase === "info") {
      // A full info sync rebuilds the station set from scratch, so a
      // forecourt that has closed or moved out of the box disappears
      // rather than lingering for ever.
      if (s.batch === 1) state.stations = {};
      for (const r of rows) if (inBox(r)) state.stations[r.node_id] = r;
    } else {
      for (const r of rows) {
        if (state.stations[r.node_id]) state.prices[r.node_id] = r.fuel_prices || [];
      }
    }
    s.seen += rows.length;
    changed = true;

    if (done || rows.length < BATCH_FULL) {
      if (s.phase === "info") {
        log.push(`info: ${s.seen} scanned, ${Object.keys(state.stations).length} in the box`);
        state.sync = { phase: "prices", batch: 1, seen: 0 };
      } else {
        log.push(`prices: ${s.seen} scanned`);
        state.sync = null;
        state.lastFull = Date.now();
        state.day = today;   // a full pass supersedes any partial increment
      }
    } else {
      s.batch++;
    }
  }

  /* ---- today's increment ---------------------------------------- */
  if (!state.sync && fetches < MAX_FETCHES_PER_TICK) {
    // A new day resets the increment window. Anything that changed late
    // yesterday is caught by the nightly full sync, not here -- the filter
    // is a calendar date, so yesterday's late changes are simply not in
    // today's answer.
    state.day = today;
    let batch = 1;
    for (; fetches < MAX_FETCHES_PER_TICK; batch++) {
      const { rows, done, error } = await getBatch(
        token, `/api/v1/pfs/fuel-prices?batch-number=${batch}&effective-start-timestamp=${today}`);
      fetches++;
      if (error) { state.lastError = `increment batch ${batch}: ${error}`; break; }

      let hits = 0;
      for (const r of rows) {
        if (state.stations[r.node_id]) {
          state.prices[r.node_id] = r.fuel_prices || [];
          hits++;
          changed = true;
        }
      }
      if (hits) log.push(`increment batch ${batch}: ${hits} of ours`);
      if (done || rows.length < BATCH_FULL) break;
    }
  }

  state.checkedAt = new Date().toISOString();
  if (changed) state.changedAt = state.checkedAt;
  await env.FUEL.put(K_STATE, JSON.stringify(state));
  // Written EVERY tick, not only when a price moved, so checkedAt stays
  // honest. 288 small objects a day is nothing against the free tier, and
  // the alternative is a staleness warning that fires on quiet days.
  await env.FUEL.put(K_SNAP, JSON.stringify(buildSnapshot(state)), {
    httpMetadata: { contentType: "application/json" },
  });

  return {
    at: state.checkedAt,
    fetches,
    stations: Object.keys(state.stations).length,
    priced: Object.keys(state.prices).length,
    syncing: state.sync ? `${state.sync.phase} batch ${state.sync.batch}` : null,
    lastFull: state.lastFull ? new Date(state.lastFull).toISOString() : null,
    lastError: state.lastError || null,
    log,
  };
}

/* ------------------------------------------------------------------ */

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(tick(env).catch((e) => {
      console.error("tick failed:", e && e.message);
    }));
  },

  /* Status and manual trigger, so a tick can be watched without waiting five
   * minutes for cron. Key-guarded and 404s without it, which does not
   * advertise that the endpoint exists. Never emits a token. */
  async fetch(request, env) {
    const url = new URL(request.url);
    const key = url.searchParams.get("key") || "";
    const want = env.FUEL_STATUS_KEY || "";
    if (!want || key !== want) return new Response("Not found", { status: 404 });

    if (url.searchParams.get("run") === "1") {
      const out = await tick(env);
      return json(out);
    }
    const state = await load(env, K_STATE, null);
    if (!state) return json({ ok: false, note: "no state yet — run a tick" });
    return json({
      ok: true,
      checkedAt: state.checkedAt || null,
      day: state.day,
      stations: Object.keys(state.stations || {}).length,
      priced: Object.keys(state.prices || {}).length,
      syncing: state.sync ? `${state.sync.phase} batch ${state.sync.batch}` : null,
      lastFull: state.lastFull ? new Date(state.lastFull).toISOString() : null,
      lastError: state.lastError || null,
    });
  },
};

function json(obj) {
  return new Response(JSON.stringify(obj, null, 2), {
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}
