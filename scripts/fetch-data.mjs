/* Build-time data fetch for the "Largs today" board.
 *
 * Runs before every Eleventy build (locally via `npm run fetch`, in CI
 * as a workflow step). Fetches live data and writes src/_data/today.json,
 * which the templates read through Eleventy's data cascade. The deployed
 * page is pure HTML — no JavaScript runs in visitors' browsers.
 *
 * Resilience rule: a flaky API must never kill a deploy. Each source is
 * fetched independently; on failure we keep whatever value the previous
 * build baked in and log a warning. The exit code is always 0.
 *
 * Tides have a three-step fallback chain:
 *   UKHO Admiralty (if ADMIRALTY_KEY is set) → Open-Meteo ocean model
 *   → previous build's values.
 * The ADMIRALTY_KEY comes from the environment: a GitHub Actions secret
 * in CI (setting it is the go-live switch, once UKHO's written blessing
 * for the display pattern arrives), or `read -s` + `export` in a local
 * terminal for private testing. Never commit it, never echo it.
 *
 * Timezone rule: GitHub's runners are UTC. The marine request asks for
 * `timeformat=unixtime` (epoch seconds — unambiguous everywhere); UKHO
 * date-times are documented as UTC but arrive without a trailing "Z",
 * so we append one before parsing (see loadTidesUKHO). Never call Date
 * methods that depend on the machine's local timezone in this script.
 *
 * ---- Seams still open (each needs a key or a parse, wired the same way):
 *
 * TODO ferry: CalMac Largs–Cumbrae service status (no public JSON feed;
 *   fetch and parse their service-status page here, server-side).
 *
 * Roadworks are implemented below via the Scottish Road Works Register
 * open data (OGL v3) — see the roadworks section for the design.
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { inflateRawSync } from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";

const TZ = "Europe/London";
const DATA_FILE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "src",
  "_data",
  "today.json"
);

// Largs seafront for the weather model; a point out in the Fairlie
// channel for the marine model, so the ocean grid resolves to water.
const WEATHER_POINT = { lat: 55.795, lon: -4.871 };
const MARINE_POINT = { lat: 55.78, lon: -4.92 };

/* ---------- helpers ---------- */

async function fetchJSON(url, headers = {}) {
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(9000) });
  if (!response.ok) throw new Error(`HTTP ${response.status} from ${url}`);
  return response.json();
}

function currentLondonHour() {
  return Number(
    new Intl.DateTimeFormat("en-GB", {
      hour: "numeric",
      hourCycle: "h23",
      timeZone: TZ
    }).format(new Date())
  );
}

// WMO weather codes -> plain words. The audience skews older: words,
// not icons, and no meteorology jargon.
function describe(code, isDay) {
  const map = {
    0: isDay ? "Sunny" : "Clear",
    1: isDay ? "Mostly sunny" : "Mostly clear",
    2: "Bright spells",
    3: "Overcast",
    45: "Fog",
    48: "Freezing fog",
    51: "Light drizzle",
    53: "Drizzle",
    55: "Heavy drizzle",
    56: "Freezing drizzle",
    57: "Freezing drizzle",
    61: "Light rain",
    63: "Rain",
    65: "Heavy rain",
    66: "Freezing rain",
    67: "Freezing rain",
    71: "Light snow",
    73: "Snow",
    75: "Heavy snow",
    77: "Snow grains",
    80: "Showers",
    81: "Showers",
    82: "Heavy showers",
    85: "Snow showers",
    86: "Snow showers",
    95: "Thundery",
    96: "Thunder, hail",
    99: "Thunder, hail"
  };
  return map[code] || "—";
}

function compass(degrees) {
  const points = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  return points[Math.round(degrees / 22.5) % 16];
}

/* ---------- weather ---------- */

async function loadWeather() {
  const url =
    "https://api.open-meteo.com/v1/forecast" +
    `?latitude=${WEATHER_POINT.lat}&longitude=${WEATHER_POINT.lon}` +
    "&current=temperature_2m,weather_code,wind_speed_10m,wind_direction_10m,is_day" +
    "&hourly=precipitation_probability" +
    "&forecast_days=1&wind_speed_unit=mph&timezone=Europe%2FLondon";

  const data = await fetchJSON(url);
  const current = data.current;
  let description = describe(current.weather_code, current.is_day === 1);

  // "shower later" if rain probability spikes in the next 8 hours and
  // it isn't already precipitating. The hourly array starts at 00:00
  // London time (we asked for that timezone), so the current London
  // hour is a direct index into it — no time-string parsing needed.
  if (current.weather_code < 51) {
    const hour = currentLondonHour();
    const window = (data.hourly?.precipitation_probability ?? [])
      .slice(hour, hour + 8)
      .filter((p) => p != null);
    if (window.length && Math.max(...window) >= 55) {
      description += ", shower later";
    }
  }

  return {
    ok: true,
    tempC: Math.round(current.temperature_2m),
    description,
    windMph: Math.round(current.wind_speed_10m),
    windDir: compass(current.wind_direction_10m)
  };
}

/* ---------- tides: UKHO Admiralty (authoritative) ---------- */
/* UK Tidal API, Discovery tier: high/low water events for a pinned
 * station (1 call per build ≈ 1,500 a month against the 10,000
 * limit). Date-times are documented as UTC
 * but carry no timezone suffix, so a "Z" is appended before parsing —
 * verify the first wired-up run against ADMIRALTY EasyTide, which
 * draws on the same predictions and should agree to the minute.
 */

const UKHO_BASE = "https://admiraltyapi.azure-api.net/uktidalapi/api/V1";

// UKHO's 608 stations include no Largs. The pick is MILLPORT (0398):
// directly across the channel on Great Cumbrae, the same body of
// water, and the reference gauge for this stretch of the Clyde —
// differences from the Largs shore are minutes at most. Verified
// against the live /Stations list on 4 Aug 2026. To re-derive: GET
// /Stations with the subscription key and search the Clyde names
// (nearby alternatives: Wemyss Bay 0399A, GREENOCK 0404).
const UKHO_STATION_ID = "0398";
const UKHO_STATION_NAME = "Millport";

async function loadTidesUKHO(key) {
  const headers = { "Ocp-Apim-Subscription-Key": key };

  const raw = await fetchJSON(`${UKHO_BASE}/Stations/${UKHO_STATION_ID}/TidalEvents?duration=3`, headers);

  const cutoff = Date.now() - 10 * 60 * 1000;
  const upcoming = raw
    .filter((event) => event && event.DateTime && event.EventType)
    .map((event) => {
      // Append "Z" unless an explicit offset is already present.
      const hasOffset = /[Zz]$|[+-]\d{2}:?\d{2}$/.test(event.DateTime);
      const t = Date.parse(hasOffset ? event.DateTime : event.DateTime + "Z");
      return {
        type: event.EventType === "HighWater" ? "High" : "Low",
        t
      };
    })
    .filter((event) => Number.isFinite(event.t) && event.t > cutoff)
    .sort((a, b) => a.t - b.t)
    .slice(0, 5)
    .map((event) => ({ type: event.type, time: new Date(event.t).toISOString() }));

  if (upcoming.length < 3) throw new Error("fewer than 3 upcoming tide events returned");

  return { ok: true, source: "ukho", station: UKHO_STATION_NAME, events: upcoming };
}

/* ---------- tides: Open-Meteo ocean model (fallback) ---------- */
/* Hourly sea level including tides; we find local maxima/minima and
 * sharpen each turning point by fitting a parabola through the three
 * surrounding samples — good to a few minutes. Model data, fine for a
 * glance at the prom; the UKHO path above replaces it when a key and
 * UKHO's blessing both exist. */

function tideEvents(timesSeconds, heights) {
  const points = [];
  for (let i = 0; i < timesSeconds.length; i++) {
    if (typeof heights[i] === "number") {
      points.push({ t: timesSeconds[i] * 1000, v: heights[i] });
    }
  }

  const raw = [];
  for (let j = 1; j < points.length - 1; j++) {
    const a = points[j - 1].v;
    const b = points[j].v;
    const c = points[j + 1].v;
    const isMax = b > a && b >= c;
    const isMin = b < a && b <= c;
    if (!isMax && !isMin) continue;

    // Parabola vertex offset in hours, clamped to ±1 sample.
    const denominator = a - 2 * b + c;
    let offset = Math.abs(denominator) > 1e-9 ? (0.5 * (a - c)) / denominator : 0;
    offset = Math.max(-1, Math.min(1, offset));

    raw.push({
      type: isMax ? "High" : "Low",
      t: points[j].t + offset * 3600000,
      v: b
    });
  }

  // Enforce High/Low alternation — model noise can produce twin peaks;
  // keep the more extreme of any same-type pair.
  const clean = [];
  for (const event of raw) {
    const previous = clean[clean.length - 1];
    if (previous && previous.type === event.type) {
      const keepNew = event.type === "High" ? event.v > previous.v : event.v < previous.v;
      if (keepNew) clean[clean.length - 1] = event;
    } else {
      clean.push(event);
    }
  }
  return clean;
}

async function loadTidesModel() {
  const url =
    "https://marine-api.open-meteo.com/v1/marine" +
    `?latitude=${MARINE_POINT.lat}&longitude=${MARINE_POINT.lon}` +
    "&hourly=sea_level_height_msl&forecast_days=3&timeformat=unixtime";

  const data = await fetchJSON(url);
  const events = tideEvents(data.hourly.time, data.hourly.sea_level_height_msl);

  const cutoff = Date.now() - 10 * 60 * 1000;
  const upcoming = events
    .filter((event) => event.t > cutoff)
    .slice(0, 5)
    .map((event) => ({ type: event.type, time: new Date(event.t).toISOString() }));

  if (upcoming.length < 3) throw new Error("fewer than 3 upcoming tide events in model data");

  return { ok: true, source: "open-meteo", events: upcoming };
}

/* ---------- tides: dispatcher ---------- */

async function loadTides() {
  const key = process.env.ADMIRALTY_KEY;
  if (key) {
    try {
      return await loadTidesUKHO(key);
    } catch (error) {
      console.warn(`tides: UKHO failed (${error.message}) — falling back to ocean model`);
    }
  }
  return loadTidesModel();
}

/* ---------- roadworks: Scottish Road Works Register ---------- */
/* Open data (OGL v3) from the statutory register. The downloads site
 * is a Django app fronting Azure blob storage with short-lived signed
 * links, so nothing has a stable file URL — instead we ask its API:
 *   GET  .../export/api/v1/files/        -> JSON list: name, size, date
 *   GET  .../export/api/v1/file/NAME/    -> tiny JSON envelope holding
 *                                            a signed blob URL
 * (behaviour verified against the live service, 4 Aug 2026; the
 * downloader below also handles a direct redirect or direct bytes, in
 * case the service changes its mind).
 *
 * Per the format spec (Data Extract v2.02), each daily file contains
 * the FULL history of every Activity touched that day, and "if
 * attempting to find the latest position for a particular Activity,
 * simply use the most recent occurrence" — so we ingest a rolling
 * window (the newest two monthly archives plus the current dailies,
 * chosen from what the list actually offers), dedupe by Activity ID
 * with latest-wins, and keep phases In Progress on Largs streets.
 * Yearly and Historical archives (hundreds of MB) are deliberately
 * ignored: the ~9-week window is the policy.
 *
 * Citizenship: monthly archives are 40–50 MB and change once a day.
 * The tiny list is fetched every build; the heavy pull happens only
 * when the list shows something newer than the cached distillate in
 * .cache/srwr-state.json, which the Actions cache carries between
 * runs. Total failure falls back to the cached state, then to the
 * previous build's values.
 */

const SRWR_API = "https://downloads.srwr.scot/export/api/v1/";
const SRWR_LIST_URL = SRWR_API + "files/";
const SRWR_FILE_URL = SRWR_API + "file/"; // + "NAME.zip/"
const SRWR_SCHEMA = 3; // bump when the distillate shape or filter changes: forces one fresh heavy pull
const SRWR_MONTHS_BACK = 2; // window: ~9 weeks; works untouched in the
                            // register for longer are rare — notices
                            // and inspections keep live records moving.
const SRWR_CACHE_FILE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  ".cache",
  "srwr-state.json"
);

// Bounding box for Largs in British National Grid metres (easting,
// northing) — generous enough for the town plus Routenburn/Netherhall,
// tight enough to exclude Fairlie and Skelmorlie. Tune here if edge
// streets are missed.
const LARGS_BBOX = { eMin: 218500, eMax: 223000, nMin: 656000, nMax: 663500 };
const LARGS_RE = /\bLARGS\b/i;

const SRWR_MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

// Traffic Management Type codes (spec: Traffic Management Types table),
// current-use codes only, phrased for the tile.
const SRWR_TM = {
  "06": "Road closure",
  "31": "Road narrowing",
  "32": "Temporary lights",
  "33": "Convoy working",
  "34": "Stop/go boards",
  "35": "Priority working",
  "36": "Give and take",
  "37": "Lane closure",
  "38": "Hard shoulder closed",
  "39": "Slip road closed",
  "40": "Contraflow",
  "41": "Footway works"
};

// Activity Category (Works Type) fallbacks when no TM type is recorded.
const SRWR_CATEGORY = {
  "01": "Minor works", "02": "Minor works", "03": "Minor works",
  "04": "Major works", "05": "Roadworks", "06": "Urgent works",
  "07": "Emergency works", "09": "Remedial works", "10": "Remedial works",
  "16": "Road restriction", "22": "Event"
};

/* Minimal ZIP reader — enough for these archives (stored or deflated
 * entries, < 4 GB). A zip is a table of contents at the end pointing
 * at deflate streams; Node's zlib does deflate, we do the table. */
function unzipEntries(buf) {
  let eocd = -1;
  const scanStart = Math.max(0, buf.length - 65557);
  for (let i = buf.length - 22; i >= scanStart; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("not a zip file (no end-of-central-directory)");
  const count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  const entries = [];
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(off) !== 0x02014b50) throw new Error("bad zip central directory");
    const method = buf.readUInt16LE(off + 10);
    const compSize = buf.readUInt32LE(off + 20);
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    const localOff = buf.readUInt32LE(off + 42);
    const name = buf.toString("utf8", off + 46, off + 46 + nameLen);
    entries.push({
      name,
      read() {
        if (buf.readUInt32LE(localOff) !== 0x04034b50) throw new Error("bad zip local header");
        const lNameLen = buf.readUInt16LE(localOff + 26);
        const lExtraLen = buf.readUInt16LE(localOff + 28);
        const start = localOff + 30 + lNameLen + lExtraLen;
        const data = buf.subarray(start, start + compSize);
        if (method === 0) return data;
        if (method === 8) return inflateRawSync(data);
        throw new Error(`unsupported zip compression method ${method}`);
      }
    });
    off += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/* Streaming CSV parser (RFC 4180: quoted fields may contain commas,
 * newlines, and doubled quotes). Stateful so multi-hundred-MB files can
 * be fed in chunks without ever holding one giant string — V8 caps
 * strings around 512 MB and the inflated monthly archives flirt with
 * that. */
class CSVParser {
  constructor(onRow) {
    this.onRow = onRow;
    this.field = "";
    this.row = [];
    this.inQuotes = false;
    this.closingQuote = false; // saw a quote at a chunk boundary; is it an escape?
  }
  push(s) {
    let i = 0;
    const n = s.length;
    if (this.closingQuote) {
      this.closingQuote = false;
      if (s[0] === '"') { this.field += '"'; this.inQuotes = true; i = 1; }
      else { this.inQuotes = false; }
    }
    while (i < n) {
      if (this.inQuotes) {
        let start = i;
        while (i < n && s[i] !== '"') i++;
        this.field += s.slice(start, i);
        if (i < n) {
          if (i + 1 === n) { this.closingQuote = true; i++; }
          else if (s[i + 1] === '"') { this.field += '"'; i += 2; }
          else { this.inQuotes = false; i++; }
        }
      } else {
        const c = s[i];
        if (c === '"' && this.field === "") { this.inQuotes = true; i++; }
        else if (c === ",") { this.row.push(this.field); this.field = ""; i++; }
        else if (c === "\n") { this.row.push(this.field); this.field = ""; this.onRow(this.row); this.row = []; i++; }
        else if (c === "\r") { i++; }
        else {
          let start = i;
          while (i < n) {
            const ch = s[i];
            if (ch === "," || ch === "\n" || ch === "\r" || ch === '"') break;
            i++;
          }
          this.field += s.slice(start, i);
        }
      }
    }
  }
  end() {
    if (this.closingQuote) { this.inQuotes = false; this.closingQuote = false; }
    if (this.field !== "" || this.row.length) { this.row.push(this.field); this.onRow(this.row); this.row = []; this.field = ""; }
  }
}

// Feed a Buffer to a CSVParser in slices without splitting a UTF-8
// character across the boundary.
function feedBuffer(buf, parser, chunkBytes = 32 * 1024 * 1024) {
  let start = 0;
  while (start < buf.length) {
    let end = Math.min(start + chunkBytes, buf.length);
    while (end < buf.length && (buf[end] & 0xc0) === 0x80) end--;
    parser.push(buf.toString("utf8", start, end));
    start = end;
  }
  parser.end();
}

function geomInBbox(wkt) {
  if (!wkt) return false;
  const re = /(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/g;
  let m;
  while ((m = re.exec(wkt)) !== null) {
    const e = Number(m[1]);
    const n = Number(m[2]);
    if (e >= LARGS_BBOX.eMin && e <= LARGS_BBOX.eMax && n >= LARGS_BBOX.nMin && n <= LARGS_BBOX.nMax) return true;
  }
  return false;
}

function tidyLocation(text) {
  const t = (text || "").replace(/\s+/g, " ").trim();
  if (!t) return "";
  const letters = t.replace(/[^A-Za-z]/g, "");
  const upper = letters.replace(/[^A-Z]/g, "");
  let out = t;
  if (letters.length > 3 && upper.length / letters.length > 0.6) {
    out = t.toLowerCase().replace(/(^|[\s\-/(])([a-z])/g, (all, pre, ch) => pre + ch.toUpperCase());
  }
  return out.length > 44 ? out.slice(0, 43).trimEnd() + "…" : out;
}

function firstDateOf(...values) {
  for (const v of values) {
    const d = (v || "").slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
  }
  return "";
}

function lastDayOfMonth(y, m) {
  return `${y}-${String(m).padStart(2, "0")}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;
}


// The register publishes dates as DD/MM/YYYY.
function parseUKDate(s) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec((s || "").trim());
  return m ? { y: +m[3], mo: +m[2], d: +m[1] } : null;
}
function isoOf(y, mo, d) {
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}
function minusOneDay(y, mo, d) {
  const t = new Date(Date.UTC(y, mo - 1, d));
  t.setUTCDate(t.getUTCDate() - 1);
  return isoOf(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

/* Turn the register's file list into a pull plan: the newest
 * SRWR_MONTHS_BACK monthly archives plus all current dailies, in
 * chronological order (so latest-occurrence-wins falls out naturally),
 * each tagged with the date its data runs to. A daily published on the
 * 4th covers the 3rd; JUL.zip published 2 Aug covers July. */
function srwrPlan(files) {
  const dailies = [];
  const months = [];
  for (const f of files || []) {
    const pub = parseUKDate(f.date);
    if (!pub || !f.name) continue;
    if (/^\d{2}\.zip$/i.test(f.name)) {
      dailies.push({ name: f.name, covers: minusOneDay(pub.y, pub.mo, pub.d) });
    } else if (/^[A-Z]{3}\.zip$/i.test(f.name)) {
      const mi = SRWR_MONTHS.indexOf(f.name.slice(0, 3).toUpperCase()) + 1;
      if (!mi) continue;
      const coveredYear = mi >= pub.mo ? pub.y - 1 : pub.y; // DEC.zip publishes in January
      months.push({ name: f.name, covers: lastDayOfMonth(coveredYear, mi) });
    }
    // yearly (YYYY.zip) and Historical archives: ignored by policy.
  }
  months.sort((a, b) => (a.covers < b.covers ? -1 : 1));
  dailies.sort((a, b) => (a.covers < b.covers ? -1 : 1));
  const plan = [...months.slice(-SRWR_MONTHS_BACK), ...dailies];
  return { plan, newestCovers: plan.length ? plan[plan.length - 1].covers : null };
}

/* British National Grid (OSGB36, EPSG:27700) -> WGS84 lat/lon. The
 * classic Ordnance Survey mathematics: inverse Transverse Mercator on
 * the Airy 1830 ellipsoid, then a Helmert datum shift. Accurate to a
 * few metres — ample for map dots. */
function osgbToWgs84(E, N) {
  const a = 6377563.396, b = 6356256.909, F0 = 0.9996012717;
  const lat0 = (49 * Math.PI) / 180, lon0 = (-2 * Math.PI) / 180;
  const N0 = -100000, E0 = 400000;
  const e2 = 1 - (b * b) / (a * a);
  const n = (a - b) / (a + b), n2 = n * n, n3 = n * n * n;

  let lat = lat0, M = 0;
  do {
    lat = (N - N0 - M) / (a * F0) + lat;
    const dl = lat - lat0, sl = lat + lat0;
    M = b * F0 * (
      (1 + n + 1.25 * n2 + 1.25 * n3) * dl
      - (3 * n + 3 * n2 + 2.625 * n3) * Math.sin(dl) * Math.cos(sl)
      + (1.875 * n2 + 1.875 * n3) * Math.sin(2 * dl) * Math.cos(2 * sl)
      - (35 / 24) * n3 * Math.sin(3 * dl) * Math.cos(3 * sl)
    );
  } while (N - N0 - M >= 0.00001);

  const sinLat = Math.sin(lat), cosLat = Math.cos(lat), tanLat = Math.tan(lat);
  const nu = (a * F0) / Math.sqrt(1 - e2 * sinLat * sinLat);
  const rho = (a * F0 * (1 - e2)) / Math.pow(1 - e2 * sinLat * sinLat, 1.5);
  const eta2 = nu / rho - 1;
  const t2 = tanLat * tanLat, t4 = t2 * t2, t6 = t4 * t2;
  const dE = E - E0, dE2 = dE * dE;

  const VII = tanLat / (2 * rho * nu);
  const VIII = (tanLat / (24 * rho * nu ** 3)) * (5 + 3 * t2 + eta2 - 9 * t2 * eta2);
  const IX = (tanLat / (720 * rho * nu ** 5)) * (61 + 90 * t2 + 45 * t4);
  const X = 1 / (cosLat * nu);
  const XI = (nu / rho + 2 * t2) / (6 * cosLat * nu ** 3);
  const XII = (5 + 28 * t2 + 24 * t4) / (120 * cosLat * nu ** 5);
  const XIIA = (61 + 662 * t2 + 1320 * t4 + 720 * t6) / (5040 * cosLat * nu ** 7);

  const phi = lat - VII * dE2 + VIII * dE2 * dE2 - IX * dE2 * dE2 * dE2;
  const lam = lon0 + X * dE - XI * dE * dE2 + XII * dE * dE2 * dE2 - XIIA * dE * dE2 * dE2 * dE2;

  // Helmert OSGB36 -> WGS84 via cartesian coordinates
  const toCart = (la, lo, ea, eb) => {
    const ee2 = 1 - (eb * eb) / (ea * ea);
    const v = ea / Math.sqrt(1 - ee2 * Math.sin(la) ** 2);
    return [v * Math.cos(la) * Math.cos(lo), v * Math.cos(la) * Math.sin(lo), v * (1 - ee2) * Math.sin(la)];
  };
  const [x1, y1, z1] = toCart(phi, lam, a, b);
  const tx = 446.448, ty = -125.157, tz = 542.06;
  const s = -20.4894e-6;
  const rx = (0.1502 / 3600) * (Math.PI / 180);
  const ry = (0.247 / 3600) * (Math.PI / 180);
  const rz = (0.8421 / 3600) * (Math.PI / 180);
  const x2 = tx + (1 + s) * x1 - rz * y1 + ry * z1;
  const y2 = ty + rz * x1 + (1 + s) * y1 - rx * z1;
  const z2 = tz - ry * x1 + rx * y1 + (1 + s) * z1;

  const wa = 6378137, wb = 6356752.3141;
  const we2 = 1 - (wb * wb) / (wa * wa);
  const p = Math.sqrt(x2 * x2 + y2 * y2);
  let wlat = Math.atan2(z2, p * (1 - we2));
  for (let i = 0; i < 6; i++) {
    const v = wa / Math.sqrt(1 - we2 * Math.sin(wlat) ** 2);
    wlat = Math.atan2(z2 + we2 * v * Math.sin(wlat), p);
  }
  return { lat: (wlat * 180) / Math.PI, lng: (Math.atan2(y2, x2) * 180) / Math.PI };
}

// Centroid of a WKT geometry's grid references, as WGS84 (or null).
function geomCentroidWgs84(wkt) {
  if (!wkt) return null;
  const re = /(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/g;
  let m, se = 0, sn = 0, k = 0;
  while ((m = re.exec(wkt)) !== null) { se += Number(m[1]); sn += Number(m[2]); k++; }
  if (!k) return null;
  const point = osgbToWgs84(se / k, sn / k);
  return { lat: Math.round(point.lat * 1e5) / 1e5, lng: Math.round(point.lng * 1e5) / 1e5 };
}

/* Download one archive. The file endpoint answers with a small JSON
 * envelope containing a short-lived signed Azure URL; we scan the
 * envelope for the first https:// string rather than assuming a field
 * name. If the endpoint ever returns a redirect or raw bytes instead,
 * both still work. */
async function srwrDownload(name) {
  const res = await fetch(SRWR_FILE_URL + name + "/", { signal: AbortSignal.timeout(180000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const type = res.headers.get("content-type") || "";
  if (/json/i.test(type)) {
    const body = await res.json();
    const url =
      (typeof body === "string" && /^https?:\/\//.test(body) && body) ||
      (body && Object.values(body).find((v) => typeof v === "string" && /^https?:\/\//.test(v)));
    if (!url) throw new Error("file endpoint returned JSON without a download URL");
    const blob = await fetch(url, { signal: AbortSignal.timeout(180000) });
    if (!blob.ok) throw new Error(`HTTP ${blob.status} from signed URL`);
    return Buffer.from(await blob.arrayBuffer());
  }
  return Buffer.from(await res.arrayBuffer());
}

async function loadRoadworks() {
  let cached = null;
  try { cached = JSON.parse(await readFile(SRWR_CACHE_FILE, "utf8")); } catch { /* no cache yet */ }
  if (cached && cached.schema !== SRWR_SCHEMA) {
    console.log("roadworks: cached state uses an older schema — refreshing");
    cached = null;
  }

  const fromCache = (state, note) => {
    if (note) console.log(`roadworks: ${note}`);
    return {
      ok: true, source: "srwr", dataDate: state.dataDate,
      count: state.count,
      activeCount: state.activeCount ?? state.count,
      plannedCount: state.plannedCount ?? 0,
      items: state.items
    };
  };

  let listing;
  try {
    const res = await fetch(SRWR_LIST_URL, { signal: AbortSignal.timeout(20000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    listing = (await res.json()).files;
  } catch (error) {
    if (cached) return fromCache(cached, `register list unreachable (${error.message}) — reusing state to ${cached.dataDate}`);
    throw new Error(`SRWR file list unreachable and no cached state (${error.message})`);
  }

  const { plan, newestCovers } = srwrPlan(listing);
  if (!plan.length) {
    if (cached) return fromCache(cached, "register list held no usable files — reusing state");
    throw new Error("SRWR list held no usable files");
  }
  if (cached && cached.dataDate >= newestCovers) {
    return fromCache(cached, `cached state matches newest register publication (${cached.dataDate})`);
  }
  if (cached && cached.attemptedAt && Date.now() - Date.parse(cached.attemptedAt) < 3600000) {
    return fromCache(cached, `newer register data listed but last pull attempt was under an hour ago — reusing state to ${cached.dataDate}`);
  }

  // ---- heavy pull
  const activities = new Map();
  const orgs = new Map();
  const act = (id) => {
    let a = activities.get(id);
    if (!a) { a = { phases: {}, und: {} }; activities.set(id, a); }
    return a;
  };
  const onRow = (r) => {
    switch (r[1]) {
      case "001": { const a = act(r[2]); a.promoter = r[5]; a.latestPhase = r[11]; break; }
      case "004": { const a = act(r[2]); if (r[5]) a.street = r[5]; break; }
      case "007": { const a = act(r[2]); a.phases[r[7]] = { loc: r[6], cat: r[9], status: r[10], cancelled: r[11], geom: r[12] }; break; }
      case "008": { const a = act(r[2]); a.und[r[3]] = { tm: r[21], proposedStart: r[4], earliestProposed: r[12], estProposed: r[8], latestPossible: r[14], reasonable: r[16], inProgress: r[71] || "" }; break; }
      case "098": { orgs.set(String(r[3]).padStart(6, "0"), r[4]); break; }
    }
  };

  let newestLoaded = null;
  let loadedCount = 0;
  for (const f of plan) {
    try {
      const buf = await srwrDownload(f.name);
      const entries = unzipEntries(buf);
      const entry =
        entries.find((e) => /redacted/i.test(e.name) && /\.csv$/i.test(e.name)) ||
        entries.find((e) => /\.csv$/i.test(e.name));
      if (!entry) throw new Error("no CSV inside archive");
      const parser = new CSVParser(onRow);
      feedBuffer(entry.read(), parser);
      newestLoaded = f.covers;
      loadedCount++;
      console.log(`roadworks: ingested ${f.name} (${(buf.length / 1048576).toFixed(1)} MB zipped, data to ${f.covers})`);
    } catch (error) {
      console.warn(`roadworks: skipped ${f.name} — ${error.message}`);
    }
  }

  if (!loadedCount) {
    if (cached) {
      const kept = { ...cached, attemptedAt: new Date().toISOString() };
      try {
        await mkdir(path.dirname(SRWR_CACHE_FILE), { recursive: true });
        await writeFile(SRWR_CACHE_FILE, JSON.stringify(kept, null, 2) + "\n");
      } catch { /* cache write is best-effort */ }
      return fromCache(cached, "no register archives reachable — reusing previous state");
    }
    throw new Error("no SRWR archives could be fetched and no cached state exists");
  }

  const todayIso = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit"
  }).format(new Date());

  const items = [];
  let activeCount = 0;
  let plannedCount = 0;
  for (const a of activities.values()) {
    const phaseNo = a.latestPhase && a.phases[a.latestPhase] ? a.latestPhase
      : Object.keys(a.phases).sort((x, y) => Number(y) - Number(x))[0];
    const ph = phaseNo ? a.phases[phaseNo] : null;
    if (!ph) continue;
    const status = ph.status === "05" ? "active" : ph.status === "04" ? "planned" : null; // 05 In Progress, 04 Proposed
    if (!status || ph.cancelled === "True") continue;
    // Coordinates are the promoter's own registered position — when they
    // exist, they decide. The text match only rescues records with no
    // usable geometry (otherwise "the Greenock–Largs road" plants dots
    // in Greenock and drags the map's bounds up the coast).
    const ll = geomCentroidWgs84(ph.geom);
    const inLargs = ll
      ? geomInBbox(ph.geom)
      : (LARGS_RE.test(ph.loc || "") || LARGS_RE.test(a.street || ""));
    if (!inLargs) continue;
    if (status === "active") activeCount++; else plannedCount++;
    const u = a.und[phaseNo] || {};
    items.push({
      status,
      what: SRWR_TM[u.tm] || SRWR_CATEGORY[ph.cat] || "Road works",
      where: tidyLocation(ph.loc || a.street || ""),
      until: firstDateOf(u.inProgress, u.estProposed, u.latestPossible, u.reasonable),
      from: firstDateOf(u.proposedStart, u.earliestProposed),
      promoter: orgs.get(String(a.promoter || "").replace(/\D/g, "").padStart(9, "0").slice(0, 6)) || "",
      lat: ll ? ll.lat : null,
      lng: ll ? ll.lng : null
    });
  }
  // Active works first (future end dates leading, overruns sinking),
  // then planned works by start date — so the tile's items[0] is always
  // the most relevant live work.
  const sortKey = (w) => w.status === "active"
    ? (w.until && w.until >= todayIso ? "A1" + w.until : w.until ? "A2" + w.until : "A3")
    : (w.from ? "B1" + w.from : "B3");
  items.sort((x, y) => (sortKey(x) < sortKey(y) ? -1 : 1));

  const now = new Date().toISOString();
  const state = {
    schema: SRWR_SCHEMA,
    dataDate: newestLoaded,
    fetchedAt: now,
    attemptedAt: now,
    count: activeCount,
    activeCount,
    plannedCount,
    items: items.slice(0, 40)
  };
  await mkdir(path.dirname(SRWR_CACHE_FILE), { recursive: true });
  await writeFile(SRWR_CACHE_FILE, JSON.stringify(state, null, 2) + "\n");
  return { ok: true, source: "srwr", dataDate: state.dataDate, count: state.count, activeCount, plannedCount, items: state.items };
}

/* ---------- main ---------- */

// Start from the previous build's data so a failed source degrades to
// stale rather than blank.
let out = { fetchedAt: null, weather: { ok: false }, tides: { ok: false, events: [] }, roadworks: { ok: false, items: [] } };
try {
  out = { ...out, ...JSON.parse(await readFile(DATA_FILE, "utf8")) };
} catch {
  console.warn("today.json missing or unreadable — starting fresh");
}

let anySuccess = false;

try {
  out.weather = await loadWeather();
  anySuccess = true;
  console.log(`weather: ${out.weather.tempC}°C, ${out.weather.description}`);
} catch (error) {
  console.warn(`weather: keeping previous value — ${error.message}`);
}

try {
  out.tides = await loadTides();
  anySuccess = true;
  const label = out.tides.source === "ukho" ? `UKHO station "${out.tides.station}"` : "ocean model";
  console.log(`tides: ${label} — next ${out.tides.events[0].type.toLowerCase()} at ${out.tides.events[0].time}`);
} catch (error) {
  console.warn(`tides: keeping previous value — ${error.message}`);
}

try {
  out.roadworks = await loadRoadworks();
  anySuccess = true;
  console.log(`roadworks: ${out.roadworks.count} active, ${out.roadworks.plannedCount ?? 0} planned in Largs (register data to ${out.roadworks.dataDate})`);
} catch (error) {
  console.warn(`roadworks: keeping previous value — ${error.message}`);
}

if (anySuccess) out.fetchedAt = new Date().toISOString();

await writeFile(DATA_FILE, JSON.stringify(out, null, 2) + "\n");
console.log(anySuccess ? "today.json updated" : "no live data reachable — previous values kept");
