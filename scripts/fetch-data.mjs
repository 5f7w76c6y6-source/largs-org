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

/* Eight plain-English names for the tile — the sixteen-point rose is
   forecast-speak; "North-westerly" is what a person says. compass()
   stays for anything that wants the abbreviation. */
function windName(degrees) {
  const names = ["Northerly", "North-easterly", "Easterly", "South-easterly",
                 "Southerly", "South-westerly", "Westerly", "North-westerly"];
  return names[Math.round(degrees / 45) % 8];
}

/* ---------- weather ---------- */

async function loadWeather() {
  const url =
    "https://api.open-meteo.com/v1/forecast" +
    `?latitude=${WEATHER_POINT.lat}&longitude=${WEATHER_POINT.lon}` +
    "&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m,wind_direction_10m,is_day" +
    "&hourly=precipitation_probability,weather_code" +
    "&daily=sunrise,sunset" +
    "&forecast_days=1&wind_speed_unit=mph&timezone=Europe%2FLondon";

  const data = await fetchJSON(url);
  const current = data.current;
  let description = describe(current.weather_code, current.is_day === 1);

  if (current.weather_code < 51) {
    const hour = currentLondonHour();
    const window = (data.hourly?.precipitation_probability ?? [])
      .slice(hour, hour + 8)
      .filter((p) => p != null);
    if (window.length && Math.max(...window) >= 55) {
      description += ", shower later";
    }
  }

  const hhmm = iso => iso ? iso.slice(11, 16) : null;

  return {
    ok: true,
    tempC: Math.round(current.temperature_2m),
    description,
    // The WMO code and day flag drive the condition glyph on the tile.
    // The glyph depicts the sky RIGHT NOW; `description` may carry a
    // forecast clause ("...shower later") that the glyph deliberately
    // does not show. Words forecast, the picture depicts.
    code: current.weather_code,
    isDay: current.is_day === 1,
    windMph: Math.round(current.wind_speed_10m),
    windDir: compass(current.wind_direction_10m),
    windName: windName(current.wind_direction_10m),
    feelsLine:
      Number.isFinite(current.apparent_temperature) &&
      Math.round(current.apparent_temperature) !== Math.round(current.temperature_2m)
        ? "Feels like " + Math.round(current.apparent_temperature) + "\u00B0"
        : "",
    sunrise: hhmm(data.daily?.sunrise?.[0]),
    sunset:  hhmm(data.daily?.sunset?.[0]),
    outlook: buildOutlook(data, current)
  };
}

/* The next eight hours as four two-hour blocks, anchored to even hours
 * so the first block contains the hour you are standing in: at 14:20
 * the row reads 14:00, 16:00, 18:00, 20:00.
 *
 * Each block takes the HIGHEST WMO code of its two hours. The code table
 * is roughly ordered by severity — clear(0) < cloud(3) < drizzle(51) <
 * rain(61) < snow(71) < showers(80) < thunder(95) — so the max is a
 * one-line way of saying "if there is rain in this block, show rain".
 * A shower at 15:40 must not be hidden by sunshine at 15:00.
 *
 * Day or night is decided per block against today's sunrise and sunset,
 * not against the current moment, so the 20:00 block gets a moon on an
 * evening when the sun sets at 20:56 and it has not set yet.
 */
function hhmmToMin(iso) {
  if (typeof iso !== "string" || iso.length < 16) return null;
  return Number(iso.slice(11, 13)) * 60 + Number(iso.slice(14, 16));
}

function buildOutlook(data, current) {
  const codes = data.hourly?.weather_code;
  const times = data.hourly?.time;
  if (!Array.isArray(codes) || !Array.isArray(times)) return [];

  // Anchor to the NEXT even hour, not the current one. The tile's main
  // glyph already shows the sky right now; a block labelled 14:00 at
  // 14:23 would repeat it and spend a slot saying nothing new. Starting
  // at the next boundary makes the row purely "what is coming".
  const hourNow = currentLondonHour();
  const start = hourNow + (2 - (hourNow % 2));

  // Compare in MINUTES, not hours. Comparing hours throws away the
  // minutes of sunrise and sunset, so any block starting in the same
  // hour as either is mislabelled: with sunset at 20:56, the 20:00
  // block failed the test `20 < 20` and was drawn as night.
  const riseM = hhmmToMin(data.daily?.sunrise?.[0]);
  const setM  = hhmmToMin(data.daily?.sunset?.[0]);

  const blocks = [];
  for (let b = 0; b < 4; b++) {
    const h = start + b * 2;
    const i = times.findIndex((t) => Number(t.slice(11, 13)) === (h % 24));
    if (i === -1) break;
    const pair = [codes[i], codes[i + 1]].filter((c) => c != null);
    if (!pair.length) break;
    blocks.push({
      hour: String(h % 24).padStart(2, "0") + ":00",
      code: Math.max(...pair),
      isDay: riseM != null && setM != null
        ? (h % 24) * 60 >= riseM && (h % 24) * 60 < setM
        : true
    });
  }
  return blocks;
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

/* Pick the slice of the hourly series to draw: from three hours behind
 * nowMs to twenty-four ahead. Returns [start, end) indices for slice().
 * Pure and boring on purpose — it has a unit test. */
function curveWindow(timesSeconds, nowMs) {
  const lo = nowMs - 3 * 3600e3;
  const hi = nowMs + 24 * 3600e3;
  let start = 0;
  while (start < timesSeconds.length && timesSeconds[start] * 1000 < lo) start++;
  let end = start;
  while (end < timesSeconds.length && timesSeconds[end] * 1000 <= hi) end++;
  return [start, end];
}

/* Compress the hourly sea-level series into a small SVG-ready curve.
 * Geometry is computed here, at fetch time, so the template stays
 * arithmetic-free and today.json stays compact: one decimal place per
 * coordinate. The "now" dot is baked at fetch time too — on a 240px /
 * 3-day scale the half-hourly rebuild moves it under 2px, well inside
 * the model badge's honesty. UKHO Discovery has no hourly series, so
 * that path simply carries no curve — which structurally enforces the
 * consistent-pairs rule: a model curve can never sit beside UKHO times. */
function buildCurve(timesSeconds, heights, nowMs) {
  const pts = [];
  for (let i = 0; i < timesSeconds.length; i++) {
    if (typeof heights[i] === "number") {
      pts.push({ t: timesSeconds[i] * 1000, v: heights[i] });
    }
  }
  if (pts.length < 12) return null;

  const W = 240, H = 56, PAD = 4;
  const t0 = pts[0].t, t1 = pts[pts.length - 1].t;
  let vMin = Infinity, vMax = -Infinity;
  for (const p of pts) {
    if (p.v < vMin) vMin = p.v;
    if (p.v > vMax) vMax = p.v;
  }
  if (!(t1 > t0) || !(vMax > vMin)) return null;

  const x = (t) => ((t - t0) / (t1 - t0)) * W;
  const y = (v) => H - PAD - ((v - vMin) / (vMax - vMin)) * (H - 2 * PAD);
  const r1 = (n) => Math.round(n * 10) / 10;

  const line = pts.map((p) => `${r1(x(p.t))},${r1(y(p.v))}`).join(" ");
  const area = `0,${H} ${line} ${W},${H}`;

  const curve = { w: W, h: H, line, area };
  if (nowMs > t0 && nowMs < t1) {
    let i = 1;
    while (i < pts.length - 1 && pts[i].t < nowMs) i++;
    const a = pts[i - 1], b = pts[i];
    const f = b.t > a.t ? (nowMs - a.t) / (b.t - a.t) : 0;
    curve.nowX = r1(x(nowMs));
    curve.nowY = r1(y(a.v + (b.v - a.v) * f));
  }
  return curve;
}

async function loadTidesModel() {
  const url =
    "https://marine-api.open-meteo.com/v1/marine" +
    `?latitude=${MARINE_POINT.lat}&longitude=${MARINE_POINT.lon}` +
    "&hourly=sea_level_height_msl&current=sea_surface_temperature&forecast_days=3&timeformat=unixtime";

  const data = await fetchJSON(url);
  const events = tideEvents(data.hourly.time, data.hourly.sea_level_height_msl);

  // Window the drawn curve to the story the tile actually tells: a
  // three-hour lead-in so the "now" dot has an approach, then the next
  // 24 hours — which by construction contains the three timings
  // printed above it, whatever hour the build runs. Two humps, no
  // seismograph, nothing drawn that isn't spoken for. The events table
  // still sees the full three-day series.
  const nowMs = Date.now();
  const [wStart, wEnd] = curveWindow(data.hourly.time, nowMs);
  const curve = buildCurve(
    data.hourly.time.slice(wStart, wEnd),
    data.hourly.sea_level_height_msl.slice(wStart, wEnd),
    nowMs
  );

  const cutoff = Date.now() - 10 * 60 * 1000;
  const upcoming = events
    .filter((event) => event.t > cutoff)
    .slice(0, 5)
    .map((event) => ({ type: event.type, time: new Date(event.t).toISOString() }));

  if (upcoming.length < 3) throw new Error("fewer than 3 upcoming tide events in model data");

  const seaTempC = data.current?.sea_surface_temperature != null
    ? Math.round(data.current.sea_surface_temperature)
    : null;
  return { ok: true, source: "open-meteo", events: upcoming, curve, seaTempC };
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
const SRWR_SCHEMA = 5; // bump when the distillate shape or filter changes: forces one fresh heavy pull
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

/* The register writes in shorthand — O/S, Jcn, NB & SB, work-package
   prefixes, town-and-postcode tails. This translates it into the words a
   person would say, cuts multi-workpoint lists to their first point, and
   strips debris BEFORE truncating so the ellipsis never spends its budget
   on a postcode. The register's own typos are left alone: we translate
   its shorthand, we do not correct its record. */
function cleanRegisterText(text) {
  let t = (text || "").replace(/\s+/g, " ").trim();
  if (!t) return "";
  t = t.split(";")[0];
  t = t.replace(/^wp\s*\d+\s*[:\-]\s*/i, "");
  t = t.replace(/^\(\s*largs\s*\)\s*[-\u2013:]?\s*/i, "");
  // Shouty raws are normalised FIRST — the dictionary's lowercase output
  // otherwise dilutes the uppercase ratio and the fix never fires.
  const letters0 = t.replace(/[^A-Za-z]/g, "");
  const upper0 = letters0.replace(/[^A-Z]/g, "");
  if (letters0.length > 3 && upper0.length / letters0.length > 0.6) {
    t = t.toLowerCase().replace(/(^|[\s\-/(])([a-z])/g, (all, pre, ch) => pre + ch.toUpperCase());
  }
  t = t.replace(/\bjcn\s*\.?\s*of\b|\bjcnof\b/gi, "junction of");
  t = t.replace(/\bjcns?\.?(?=\s|$)/gi, "junction");
  t = t.replace(/\bjcts?\.?(?=\s|$)/gi, "junction");
  t = t.replace(/\bo\/s\b/gi, "outside");
  // These must run BEFORE the "/" → " and " rule below, or the register's
  // f/path becomes "f and path", which is how it reached the page.
  t = t.replace(/\bf\s*\/\s*path\b/gi, "footpath");
  t = t.replace(/\bf\s*\/\s*w\b/gi, "footway");
  t = t.replace(/\bc\s*\/\s*w\b/gi, "carriageway");
  t = t.replace(/\blhs\b/gi, "left-hand side");
  t = t.replace(/\brhs\b/gi, "right-hand side");
  t = t.replace(/\bopp\.?(?=\s|$)/gi, "opposite");
  t = t.replace(/\bnb\s*&\s*sb\b/gi, "northbound and southbound");
  t = t.replace(/\bno\.?\s*(?=\d)/gi, "number ");
  t = t.replace(/\s*\+\s*/g, " and ");
  t = t.replace(/\s*&\s*/g, " and ");
  t = t.replace(/\s*\/\s*/g, " and ");
  t = t.replace(/,(?=\S)/g, ", ");
  for (let i = 0; i < 6; i++) {
    t = t.replace(/[\s,;.]+$/, "");
    t = t.replace(/[,\s]+ka\d{1,2}(\s*\d[a-z]{0,2})?$/i, "");
    t = t.replace(/[,\s]+largs$/i, "");
    t = t.replace(/[,\s]+(north\s+)?ayrshire$/i, "");
    t = t.replace(/[,\s]+(united kingdom|uk|scotland)$/i, "");
  }
  t = t.replace(/,\s*largs\s*(?=,)/gi, "");
  t = t.replace(/\bLargs\b ?/g, "");
  t = t.replace(/\s*,\s*,+\s*/g, ", ").replace(/\s+/g, " ").trim();
  t = t.replace(/^[,\s]+/, "");
  t = t.replace(/\b(To|Of|At|And|From|With|Past|On|The|In)\b/g,
    (word, p1, offset) => (offset === 0 ? word : word.toLowerCase()));
  t = t.replace(/, ([a-z])(?=[a-z]{2})/g, (m, ch) => ", " + ch.toUpperCase());
  return t;
}

function tidyLocation(text, street) {
  let t = cleanRegisterText(text);
  const s = cleanRegisterText(street || "");
  if (s) {
    const key = s.split(/\s+/)[0].toLowerCase();
    if (!t) t = s;
    else if (key.length > 1 && !t.toLowerCase().includes(key)) t = t + ", " + s;
  }
  if (t) t = t[0].toUpperCase() + t.slice(1);
  t = t.replace(/[\s.]+$/, "");
  if (t.length > 44) {
    let cut = t.slice(0, 43);
    const sp = cut.lastIndexOf(" ");
    if (sp > 24) cut = cut.slice(0, sp);
    t = cut.replace(/[\s,]+$/, "") + "\u2026";
  }
  return t;
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
async function srwrDownload(name, base = SRWR_FILE_URL) {
  const res = await fetch(base + name + "/", { signal: AbortSignal.timeout(180000) });
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
      where: tidyLocation(ph.loc || "", a.street || ""),
      street: cleanRegisterText(a.street || ""),
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

/* ---------------------------------------------------------------------
 * SRWR Disruptions Export — a second roadworks source.
 *
 * Same daily register, a different published extract: one complete
 * snapshot per day (~7 MB) rather than the monthly archive, carrying
 * traffic impact and affected bus services, which the main extract does
 * not hold. Selection is deliberately geometric only — verified against
 * a full national file as selecting exactly the same works as
 * loadRoadworks(), with no text fallback required.
 * ------------------------------------------------------------------ */

const SRWR_DISRUPT_LIST_URL = "https://downloads.srwr.scot/disruptions-export/api/v1/files";
const SRWR_DISRUPT_FILE_URL = "https://downloads.srwr.scot/disruptions-export/api/v1/file/";
const SRWR_DISRUPT_CACHE_FILE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  ".cache",
  "srwr-disruptions-state.json"
);
const SRWR_DISRUPT_SCHEMA = 5;

/* The disruptions export gives TrafficManagement as text, not a code, so
 * this maps its vocabulary onto the same phrases SRWR_TM already produces.
 * Keys are lowercased and matched on inclusion — the register is not
 * consistent about its parenthetical suffixes. */
const SRWR_DISRUPT_TM = [
  ["road closure", "Road closure"],
  ["contraflow", "Contraflow"],
  ["lane closure", "Lane closure"],
  ["portable traffic lights", "Temporary lights"],
  ["multi-way signals", "Temporary lights"],
  ["two-way signals", "Temporary lights"],
  ["traffic signal", "Temporary lights"],
  ["stop/go", "Stop/go boards"],
  ["give and take", "Give and take"],
  ["priority working", "Priority working"],
  ["convoy", "Convoy working"],
  ["road narrowing", "Road narrowing"],
  ["hard shoulder", "Hard shoulder closed"],
  ["slip road", "Slip road closed"],
  ["footway", "Footway works"],
  ["no obstruction", "No obstruction"],
];

/* A skip is not roadworks. Where the register classes an activity as a
 * Permission it also names what is occupying the street, in LicenceType —
 * so the page can say "Skip" rather than describing the skip's effect on
 * traffic as though someone were digging a hole. Keys are the register's
 * own strings, lowercased; the values are what a resident would call it. */
const SRWR_PERMIT_LABEL = {
  "skip": "Skip",
  "scaffolding": "Scaffolding",
  "street café": "Street café",
  "street cafe": "Street café",
  "hoarding": "Hoarding",
  "containers/cabins/storage": "Container or cabin",
  "crane/hoist/tower/cherry picker": "Crane or hoist",
  "street furniture": "Street furniture",
  "markets/stalls": "Market stalls",
  "materials": "Building materials",
  "tree/shrub consent": "Tree or shrub work",
  "bridge/beam/rail": "Bridge or beam lift",
  "general road occupation": "Street occupation",
};

/* ActivityStatus in this feed is words, not the 04/05 phase codes, and the
 * vocabulary is wider than the specification claims. Observed across a full
 * national file: Proposed, Advance Planning, In Progress, Recorded,
 * Commenced, Potential.
 *
 * "Potential" is speculative forward planning and must not reach the page —
 * the spec says it is excluded from this export and it demonstrably is not.
 * "Recorded" is retrospective (events, traffic orders logged after the
 * fact); it is carried as planned only when it has not yet started. */
const SRWR_DISRUPT_STATUS = {
  "in progress": "active",
  "commenced": "active",
  "proposed": "planned",
  "advance planning": "planned",
  "recorded": "planned",
  "potential": null,
};

/* Road Closure sits in the same column as High/Medium/Low but is a
 * different axis. Rank it above High so severity sorts sensibly. */
const SRWR_IMPACT_RANK = { "road closure": 4, high: 3, medium: 2, low: 1, none: 0 };

/* Bus services arrive as "MCGL 576.I", "STWS 585A KK", "SHUT 40.O" —
 * operator prefix, service, optional depot code, optional direction
 * suffix. Left raw, one Main Street row claims 23 services for what a
 * resident would call about ten. Reduce to the number on the front of
 * the bus, dedupe, and sort so 40 precedes 585 precedes X585. */
function tidyBusServices(raw) {
  const seen = new Set();
  for (const part of (raw || "").split(",")) {
    const tokens = part.trim().split(/\s+/);
    if (tokens.length < 2) continue;
    const service = tokens[1].replace(/\.(I|O)$/i, "").trim();
    if (service) seen.add(service);
  }
  return [...seen].sort((a, b) => {
    const na = parseInt(a.replace(/\D/g, ""), 10);
    const nb = parseInt(b.replace(/\D/g, ""), 10);
    if (na !== nb) return na - nb;
    return a.localeCompare(b);
  });
}

async function loadRoadworksDisruptions() {
  let cached = null;
  try { cached = JSON.parse(await readFile(SRWR_DISRUPT_CACHE_FILE, "utf8")); } catch { /* no cache yet */ }
  if (cached && cached.schema !== SRWR_DISRUPT_SCHEMA) {
    console.log("roadworks(disruptions): cached state uses an older schema — refreshing");
    cached = null;
  }

  const fromCache = (state, note) => {
    if (note) console.log(`roadworks(disruptions): ${note}`);
    return {
      ok: true, source: "srwr-disruptions", dataDate: state.dataDate,
      count: state.count, activeCount: state.activeCount, plannedCount: state.plannedCount,
      permitCount: state.permitCount || 0,
      items: state.items
    };
  };

  /* Record that a pull was attempted, so a failing register does not mean
     a download every fifteen minutes. Best-effort: if the write fails the
     next build simply tries again. */
  const noteAttempt = async (state) => {
    try {
      await mkdir(path.dirname(SRWR_DISRUPT_CACHE_FILE), { recursive: true });
      await writeFile(
        SRWR_DISRUPT_CACHE_FILE,
        JSON.stringify({ ...state, attemptedAt: new Date().toISOString() }, null, 2) + "\n"
      );
    } catch { /* cache write is best-effort */ }
  };

  // ---- what is on offer. Seven dailies, newest first by name.
  let listing;
  try {
    const res = await fetch(SRWR_DISRUPT_LIST_URL, { signal: AbortSignal.timeout(20000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    listing = (await res.json()).files || [];
  } catch (error) {
    if (cached) { await noteAttempt(cached); return fromCache(cached, `list unreachable (${error.message}) — reusing state to ${cached.dataDate}`); }
    throw new Error(`SRWR disruptions list unreachable and no cached state (${error.message})`);
  }

  const files = listing
    .filter((f) => /^SRWRDisruptionsExport\d{8}\.zip$/i.test(f.name || ""))
    .sort((a, b) => (a.name < b.name ? 1 : -1));
  if (!files.length) {
    if (cached) return fromCache(cached, "list held no usable files — reusing state");
    throw new Error("SRWR disruptions list held no usable files");
  }

  const newest = files[0];
  const covers = (newest.name.match(/(\d{4})(\d{2})(\d{2})/) || []).slice(1).join("-");

  // Only seven days are retained, so there is no backfill: if the cache is
  // older than the oldest file on offer we simply take the newest and move
  // on. Nothing is reconstructed from a gap.
  if (cached && cached.dataDate >= covers) {
    return fromCache(cached, `cached state matches newest publication (${cached.dataDate})`);
  }

  // Newer data is listed, but a recent attempt failed. The workflow runs
  // every fifteen minutes; without this a register outage would mean 96
  // failed downloads a day. Same guard loadRoadworks() already applies.
  if (cached && cached.attemptedAt && Date.now() - Date.parse(cached.attemptedAt) < 3600000) {
    return fromCache(cached, `newer data listed but the last attempt was under an hour ago — reusing state to ${cached.dataDate}`);
  }

  // ---- pull
  let rows = [];
  try {
    const buf = await srwrDownload(newest.name, SRWR_DISRUPT_FILE_URL);
    const entries = unzipEntries(buf);
    const entry = entries.find((e) => /CurrentActivities\.csv$/i.test(e.name));
    if (!entry) throw new Error("no CurrentActivities.csv inside archive");

    let header = null;
    const parser = new CSVParser((r) => {
      if (!header) { header = r.map((h) => h.trim()); return; }
      if (r.length < 2) return;
      const o = {};
      for (let i = 0; i < header.length; i++) o[header[i]] = r[i] ?? "";
      rows.push(o);
    });
    feedBuffer(entry.read(), parser);
    console.log(`roadworks(disruptions): ingested ${newest.name} (${(buf.length / 1048576).toFixed(1)} MB zipped, ${rows.length} activities, data to ${covers})`);
  } catch (error) {
    if (cached) { await noteAttempt(cached); return fromCache(cached, `pull failed (${error.message}) — reusing state to ${cached.dataDate}`); }
    throw new Error(`SRWR disruptions pull failed and no cached state (${error.message})`);
  }

  // ---- filter to Largs on the promoter's own registered geometry.
  //
  // Proven against a full national file: this selects exactly the same 63
  // rows as loadRoadworks()'s rule, with no text fallback needed — every
  // row in this feed carries geometry. Town is deliberately NOT used: it is
  // the gazetteer's attribution of the USRN, so works at Wemyss Bay come
  // through on a street called "Greenock Road Largs To Shore Road
  // Skelmorlie".
  let noGeometry = 0;
  const local = rows.filter((r) => {
    const wkt = r.GeometryFull || r.GeometryCentroid;
    if (!wkt) { noGeometry++; return false; }
    return geomInBbox(wkt);
  });
  if (noGeometry) {
    console.warn(`roadworks(disruptions): ${noGeometry} rows carried no geometry and were skipped`);
  }

  // ---- one row per activity: latest phase wins, mirroring loadRoadworks().
  // Without this the page shows the A78 sea-wall scheme twice.
  const latest = new Map();
  for (const r of local) {
    const ref = (r.ActivityReference || r.LocalReference || "").trim();
    if (!ref) continue;
    const prev = latest.get(ref);
    if (!prev || Number(r.PhaseNumber || 0) > Number(prev.PhaseNumber || 0)) latest.set(ref, r);
  }

  const items = [];
  let activeCount = 0;
  let plannedCount = 0;
  let permitCount = 0;
  // Dates are shown without a year. That is only safe while every date
  // falls in the register's own year, which a six-month horizon breaks.
  const registerYear = String(covers || "").slice(0, 4);

  for (const r of latest.values()) {
    const status = SRWR_DISRUPT_STATUS[(r.ActivityStatus || "").trim().toLowerCase()] ?? null;
    if (!status) continue;

    const tmText = (r.TrafficManagement || "").toLowerCase();
    const tmLabel = (SRWR_DISRUPT_TM.find(([needle]) => tmText.includes(needle)) || [])[1] || "";

    // Permissions are titled by the thing occupying the street, not by its
    // effect on traffic. An unrecognised licence type falls back to the
    // register's own catch-all rather than silently reading as roadworks.
    const licence = (r.LicenceType || "").trim().toLowerCase();
    const permit = /^permission$/i.test((r.Category || "").trim())
      ? (SRWR_PERMIT_LABEL[licence] || "Street occupation")
      : "";

    const what = permit || tmLabel || cleanRegisterText(r.Category || "") || "Road works";

    const impact = (r.TrafficImpact || "").trim();
    const buses = tidyBusServices(r.PotentialBusServicesAffected);
    // Phrased here rather than in the template, the same way `what` is.
    // Every service is listed, however many. A truncated list — "and 2
    // others" — leaves a reader wondering whether theirs is one of the two,
    // which is worse than saying nothing at all.
    const busText = buses.join(", ");

    const from = firstDateOf(r.StartDateTimeUTC, r.EarliestStartDateTimeUTC);
    const until = firstDateOf(r.EndDateTimeUTC, r.LatestPossibleEndDateTimeUTC);

    if (status === "active") activeCount++; else plannedCount++;
    if (permit) permitCount++;

    items.push({
      status,
      what,
      permit: Boolean(permit),
      // The title now names the object, so the traffic arrangement moves to
      // the meta line rather than being dropped. "No obstruction" is the
      // register saying the permit does not block the road — true, but
      // backwards as a phrase, so say it the way a reader would.
      arrangement: !permit ? ""
        : tmLabel === "No obstruction" ? "not blocking the road"
        : tmLabel.toLowerCase(),
      where: tidyLocation(r.Location || "", r.Street || ""),
      street: cleanRegisterText(r.Street || ""),
      from,
      until,
      // Set only when the date is in another year, so ordinary rows read
      // exactly as before and nothing gains a redundant "2026".
      fromYear: from && from.slice(0, 4) !== registerYear ? from.slice(0, 4) : "",
      untilYear: until && until.slice(0, 4) !== registerYear ? until.slice(0, 4) : "",
      // "Transport Scotland - SW Unit Op Company" is an internal operating
      // district. The part after the dash tells a resident nothing.
      promoter: (r.WorksPromoterName || "").trim()
        .replace(/\s*[-\u2013]\s*\S.*\bUnit\s+Op(?:erating)?\s+Company\s*$/i, "")
        .trim(),
      lat: Number(r.Latitude) || null,
      lng: Number(r.Longitude) || null,

      // new, and the reason for doing any of this
      impact,
      impactRank: SRWR_IMPACT_RANK[impact.toLowerCase()] ?? 0,
      buses,
      busText,
      busDepartures: Number(r.PotentialBusDeparturesAffectedCount) || 0,
    });
  }

  const todayIso = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit"
  }).format(new Date());

  // Same ordering contract as loadRoadworks — active first, overruns
  // sinking, then planned by start date — so items[0] is still the most
  // relevant live work and the tile needs no change.
  const sortKey = (w) => w.status === "active"
    ? (w.until && w.until >= todayIso ? "A1" + w.until : w.until ? "A2" + w.until : "A3")
    : (w.from ? "B1" + w.from : "B3");
  items.sort((x, y) => (sortKey(x) < sortKey(y) ? -1 : 1));

  const now = new Date().toISOString();
  const state = {
    schema: SRWR_DISRUPT_SCHEMA,
    dataDate: covers,
    fetchedAt: now,
    attemptedAt: now,
    count: activeCount,
    activeCount,
    plannedCount,
    permitCount,
    items: items.slice(0, 120),
  };
  try {
    await mkdir(path.dirname(SRWR_DISRUPT_CACHE_FILE), { recursive: true });
    await writeFile(SRWR_DISRUPT_CACHE_FILE, JSON.stringify(state, null, 2) + "\n");
  } catch { /* cache write is best-effort */ }

  return {
    ok: true, source: "srwr-disruptions", dataDate: covers,
    count: activeCount, activeCount, plannedCount, permitCount, items: state.items
  };
}



/* ---------- buses ---------- */
/* McGill's timetables from their GTFS feed on the Passenger Open Data Hub
 * (OGL v3). GTFS is a zip of CSV tables that join like a small database:
 * stops, routes, trips (one journey), stop_times (every call of every
 * journey), and calendar + calendar_dates, which together say which
 * journeys run on a given date. Passenger models nearly everything as
 * calendar_dates exceptions (20,000 rows), so "runs today" is a real
 * computation and calendar.txt alone is wrong on any bank holiday.
 *
 * Fetch once a day, compute every build. The feed is 4 MB from a small
 * vendor and this workflow runs ~96 times a day, so the zip is pulled
 * only when the cached Largs SLICE is missing, stale (> BUSES_MAX_AGE_H)
 * or from an older schema. The slice keeps the 40 stops inside
 * BUSES_BOX, only the trips that call at them, and only their calendar
 * rows. Every build then derives yesterday/today/tomorrow from the slice
 * in milliseconds, so the page is always built for the right day.
 *
 * Service days, not calendar days: a 24:06 call belongs to the previous
 * day in GTFS. Each stop's list for date D is D's own calls plus the
 * after-midnight tail of D-1 (m >= 1440, shifted back by a day), so a
 * reader at 00:05 sees the 00:06 as "next" and a reader at 23:00 sees
 * it as "last". lastTo is per destination: the last bus that reaches
 * Glasgow leaves at 18:10 on a weekday, hours before the last bus.
 *
 * Timetable data only. No live positions (BODS carries none for Largs
 * — checked 1 Sep 2026), no cancellations. The page says so once.
 *
 * Stagecoach's 585 is NOT in this feed. It arrives as a second operator
 * from their TransXChange in a later pass; until then the page says
 * "McGill's services only" rather than presenting a partial list as
 * complete. Route labels below are ours — route_long_name is blank. */

// Feeds, in fetch order. Each is a Passenger Open Data Hub GTFS zip under
// the Open Government Licence v3.0. Stop IDs are NaPTAN codes (shared
// across feeds); trip, service and route IDs are only unique inside a
// feed, so the slice prefixes them with the operator key.
const BUSES_FEEDS = [
  { op: "mcgills", url: "https://data.discoverpassenger.com/operator/mcgills/dataset/current/download/gtfs" },
  // Shuttle Buses (the 40 town service, the 50) publish TransXChange only —
  // no GTFS — read by busesFetchTxcFeed(). OGL v3.
  { op: "shuttle", format: "txc", url: "https://data.discoverpassenger.com/operator/shuttlebuses/dataset/current/download/txc" },
];
const BUSES_UA = "largs.scot build (hello@largs.scot)";
const BUSES_SCHEMA = 3; // bump when the slice shape or filter changes: forces one fresh pull
const BUSES_MAX_AGE_H = 20;
const BUSES_CACHE_FILE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  ".cache",
  "buses-slice.json"
);
const BUSES_FILE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "src",
  "_data",
  "buses.json"
);
// Loose box round Largs: Routenburn and Brisbane Glen down to the
// Fairlie road, coast to hills. Same box as the September investigation.
const BUSES_BOX = { latMin: 55.74, latMax: 55.83, lonMin: -4.92, lonMax: -4.82 };
// Stops pinned to the top of the list: the corridor stop everyone means
// by "Main Street", then the 904's terminus. The rest sort by distance.
const BUSES_PINNED = ["61701147", "6170512"];
const BUSES_MAIN_STOP = "61701147";
const BUSES_OPERATORS = {
  mcgills: {
    name: "McGill's",
    credit: "McGill's Bus Service Ltd, via the Passenger Open Data Hub",
    licence: "Open Government Licence v3.0",
    url: "https://data.discoverpassenger.com/operator/mcgills",
    updates: "https://www.mcgillsbuses.co.uk/service-updates",
  },
  shuttle: {
    name: "Shuttle Buses",
    credit: "Shuttle Buses Ltd, via the Passenger Open Data Hub",
    licence: "Open Government Licence v3.0",
    url: "https://data.discoverpassenger.com/operator/shuttlebuses",
    updates: "https://www.shuttlebuses.co.uk/timetables",
    loaded: true,
  },
  stagecoach: {
    name: "Stagecoach",
    credit: "Stagecoach open data",
    licence: "Stagecoach open data terms",
    url: "https://www.stagecoachbus.com/open-data",
    updates: "https://www.stagecoachbus.com/service-updates",
    loaded: false,
    // What the page says while this operator is not loaded. Plain words,
    // ours: the template has no operator names in it.
    pending: "585 along the coast",
    pendingLong: "The 585 (Ardrossan – Largs – Greenock) runs from the same Main Street stops. Its timetable comes from Stagecoach's open data in a separate format and has not been added.",
    pendingRoutes: [{ n: "585", label: "Ardrossan – Largs – Greenock" }],
  },
};
// Ours, not the feed's. Correct these on the ground, not from memory.
const BUSES_ROUTE_LABELS = {
  "901": "Largs – Glasgow via Greenock",
  "906": "Largs – Glasgow via Greenock",
  "906X": "Largs – Glasgow express",
  "904": "Largs – Paisley",
  "576": "Largs – Greenock (evenings)",
  "578": "Largs – Greenock (evenings)",
  "40": "Largs town service",
  "50": "Largs – Kilwinning",
};
const BUSES_VIEWS = [
  { key: "all", label: "All buses", path: "/buses/" },
  { key: "mcgills", label: "McGill's", path: "/buses/mcgills/" },
  { key: "shuttle", label: "Shuttle Buses", path: "/buses/shuttle/" },
  { key: "stagecoach", label: "Stagecoach", path: "/buses/stagecoach/" },
];

// One GTFS table → array of row objects. Uses the streaming CSVParser
// above so stop_times (tens of MB inflated) never becomes one string.
function busesTable(entries, name) {
  const entry = entries.find((e) => e.name === name || e.name.endsWith("/" + name));
  if (!entry) return [];
  let header = null;
  const rows = [];
  const parser = new CSVParser((cells) => {
    if (!header) { header = cells.map((h) => h.replace(/^\uFEFF/, "").trim()); return; }
    if (cells.length === 1 && cells[0] === "") return;
    const row = {};
    header.forEach((h, i) => { row[h] = cells[i] ?? ""; });
    rows.push(row);
  });
  feedBuffer(entry.read(), parser);
  return rows;
}

function busesIsoDay(offsetDays = 0) {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit"
  }).format(new Date());
  if (!offsetDays) return today;
  const d = new Date(`${today}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}
const BUSES_DOW = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
function busesDow(iso) { return BUSES_DOW[new Date(`${iso}T12:00:00Z`).getUTCDay()]; }
// "Wednesday 2 September" — the label a reader sees on the page.
function busesDayLabel(iso) {
  return new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long" })
    .format(new Date(`${iso}T12:00:00Z`));
}
function busesYmdLabel(ymd) {
  return ymd && ymd.length === 8 ? `${ymd.slice(6, 8)}/${ymd.slice(4, 6)}/${ymd.slice(0, 4)}` : "";
}

// One feed → the Largs slice of it, with every feed-local ID prefixed
// by the operator key so feeds can be merged without collisions.
async function busesFetchFeed(feed) {
  const res = await fetch(feed.url, {
    headers: { "User-Agent": BUSES_UA },
    signal: AbortSignal.timeout(120000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${feed.url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const entries = unzipEntries(buf);
  const ns = (id) => `${feed.op}:${id}`;

  const stops = busesTable(entries, "stops.txt")
    .map((s) => ({ id: s.stop_id, name: s.stop_name, lat: Number(s.stop_lat), lon: Number(s.stop_lon) }))
    .filter((s) => s.lat >= BUSES_BOX.latMin && s.lat <= BUSES_BOX.latMax &&
                   s.lon >= BUSES_BOX.lonMin && s.lon <= BUSES_BOX.lonMax);
  const stopIds = new Set(stops.map((s) => s.id));

  const tripsAll = busesTable(entries, "trips.txt");
  const routesAll = busesTable(entries, "routes.txt");

  // One pass over stop_times: keep Largs calls, and the last sequence
  // number of every trip so a terminating call can be told from a departure.
  const calls = [];
  const lastSeq = {};
  let header = null;
  const st = entries.find((e) => e.name === "stop_times.txt" || e.name.endsWith("/stop_times.txt"));
  if (!st) throw new Error(`stop_times.txt missing from ${feed.op} feed`);
  const parser = new CSVParser((cells) => {
    if (!header) { header = cells.map((h) => h.replace(/^\uFEFF/, "").trim()); return; }
    const row = {};
    header.forEach((h, i) => { row[h] = cells[i] ?? ""; });
    if (!row.trip_id) return;
    const seq = Number(row.stop_sequence);
    if (!(row.trip_id in lastSeq) || seq > lastSeq[row.trip_id]) lastSeq[row.trip_id] = seq;
    if (stopIds.has(row.stop_id)) {
      calls.push({ trip: ns(row.trip_id), stop: row.stop_id, seq, time: row.departure_time || row.arrival_time, pickup: row.pickup_type || "0" });
    }
  });
  feedBuffer(st.read(), parser);

  const largsTrips = new Set(calls.map((c) => c.trip));
  const trips = {};
  const serviceIds = new Set();
  const routeIds = new Set();
  for (const t of tripsAll) {
    const id = ns(t.trip_id);
    if (!largsTrips.has(id)) continue;
    trips[id] = { route: ns(t.route_id), service: ns(t.service_id), headsign: t.trip_headsign || "", last: lastSeq[t.trip_id], op: feed.op };
    serviceIds.add(t.service_id);
    routeIds.add(t.route_id);
  }
  const routes = {};
  for (const r of routesAll) if (routeIds.has(r.route_id)) routes[ns(r.route_id)] = r.route_short_name || "?";

  const calendar = busesTable(entries, "calendar.txt")
    .filter((r) => serviceIds.has(r.service_id))
    .map((r) => ({ ...r, service_id: ns(r.service_id) }));
  const calendarDates = busesTable(entries, "calendar_dates.txt")
    .filter((r) => serviceIds.has(r.service_id))
    .map((r) => ({ service_id: ns(r.service_id), date: r.date, exception_type: r.exception_type }));
  const feedStart = calendar.reduce((m, r) => (r.start_date < m ? r.start_date : m), "99999999");
  const feedEnd = calendar.reduce((m, r) => (r.end_date > m ? r.end_date : m), "00000000");

  console.log(`buses: ${feed.op} GTFS (${(buf.length / 1048576).toFixed(1)} MB) — ${stops.length} Largs stops, ${Object.keys(trips).length} trips calling, feed ${feedStart}–${feedEnd}`);
  return { op: feed.op, bytes: buf.length, start: feedStart, end: feedEnd, stops, trips, routes, calendar, calendarDates, calls };
}

/* ---- TransXChange -------------------------------------------------------
 * Shuttle Buses (the 40 town service, the 50) and Stagecoach publish
 * TransXChange (TXC), not GTFS. A TXC file is one service: a VehicleJourney
 * has a DepartureTime and points at a JourneyPattern; the pattern is a chain
 * of JourneyPatternSections, each a list of timing links "from stop A to
 * stop B takes PT3M, wait PT1M". Stop times are the running sum. Which days
 * a journey runs is an OperatingProfile (days of week, date ranges in or out
 * of operation, bank-holiday rules), on the journey or inherited from the
 * service. Stops are NaPTAN ATCO codes, usually without coordinates.
 *
 * busesFetchTxcFeed() turns a TXC zip into exactly the object
 * busesFetchFeed() returns for GTFS, so everything downstream is shared:
 * profiles become GTFS-style calendar rows plus calendar_dates exceptions,
 * journeys become trips, lines become routes, walked times become calls.
 * Rules refereed against bustimes.org on 2 September 2026: running-sum
 * times; a WaitTime on the To side of one link and on the From side of the
 * next both count; an empty VehicleJourneyTimingLink inherits, it does not
 * zero; a journey with VehicleJourneyRef borrows that journey's pattern;
 * `pass` calls are not calls; the last call is an arrival. Stop positions
 * come from the DfT NaPTAN API for ATCO area 617 (OGL v3) when the file has
 * none; bank-holiday dates from gov.uk's own list, Scotland division.
 */
const BUSES_NAPTAN_URL = "https://naptan.api.dft.gov.uk/v1/access-nodes?atcoAreaCodes=617&dataFormat=csv";
const BUSES_BANK_HOLIDAYS_URL = "https://www.gov.uk/bank-holidays.json";
// Special-day and bank-holiday exceptions are expanded only inside this
// window round today; the slice is refreshed daily, so that is enough.
const BUSES_EXCEPTION_DAYS_BACK = 7, BUSES_EXCEPTION_DAYS_AHEAD = 60;

// Minimal XML → tree, for TXC as the Passenger hub emits it: one default
// namespace, attributes only on `id`, no CDATA, no DOCTYPE. Refuses anything
// it does not understand rather than guessing.
function txcDecode(t) {
  return t.replace(/&(amp|lt|gt|quot|apos|#x[0-9a-fA-F]+|#\d+);/g, (_, e) => {
    if (e === "amp") return "&"; if (e === "lt") return "<"; if (e === "gt") return ">";
    if (e === "quot") return '"'; if (e === "apos") return "'";
    return String.fromCodePoint(e[1] === "x" ? parseInt(e.slice(2), 16) : Number(e.slice(1)));
  });
}
function txcParseXml(str) {
  if (/<!\[CDATA\[|<!DOCTYPE/i.test(str)) throw new Error("TXC: CDATA/DOCTYPE not supported");
  str = str.replace(/<!--[\s\S]*?-->/g, "");
  const root = { name: "#root", attrs: {}, children: [], text: "" };
  const stack = [root];
  const re = /<([^>]+)>|([^<]+)/g;
  let m;
  while ((m = re.exec(str))) {
    if (m[2] !== undefined) {
      if (m[2].trim()) stack[stack.length - 1].text += txcDecode(m[2]);
      continue;
    }
    const tag = m[1];
    if (tag[0] === "?") continue;
    if (tag[0] === "!") throw new Error(`TXC: unsupported construct <${tag.slice(0, 24)}`);
    if (tag[0] === "/") {
      const name = tag.slice(1).trim().replace(/^[^:]+:/, "");
      const node = stack.pop();
      if (node.name !== name) throw new Error(`TXC: </${name}> closes <${node.name}>`);
      continue;
    }
    const selfClose = tag.endsWith("/");
    const body = selfClose ? tag.slice(0, -1) : tag;
    const sp = body.search(/\s/);
    const name = (sp < 0 ? body : body.slice(0, sp)).replace(/^[^:]+:/, "");
    const attrs = {};
    if (sp >= 0) for (const a of body.slice(sp).matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attrs[a[1]] = txcDecode(a[2] ?? a[3] ?? "");
    const node = { name, attrs, children: [], text: "" };
    stack[stack.length - 1].children.push(node);
    if (!selfClose) stack.push(node);
  }
  if (stack.length !== 1) throw new Error("TXC: document ended with open elements");
  return root;
}
const txcChild = (n, name) => n && n.children.find((c) => c.name === name);
const txcChildren = (n, name) => (n ? n.children.filter((c) => c.name === name) : []);
function txcText(n, ...names) {
  let cur = n;
  for (const name of names) { cur = txcChild(cur, name); if (!cur) return ""; }
  return cur.text.trim();
}

// ISO 8601 duration (PT3M, PT30S, PT1H2M, PT0S) → seconds.
function txcSeconds(s) {
  if (!s) return 0;
  const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(s);
  if (!m) throw new Error(`TXC: unparsed duration ${s}`);
  const [d, h, mi, se] = m.slice(1).map((x) => Number(x || 0));
  return ((d * 24 + h) * 60 + mi) * 60 + se;
}
const txcClockSeconds = (hms) => { const [h, m, s] = hms.split(":").map(Number); return h * 3600 + m * 60 + (s || 0); };
const txcHms = (sec) => `${String(Math.floor(sec / 3600)).padStart(2, "0")}:${String(Math.floor(sec / 60) % 60).padStart(2, "0")}:${String(sec % 60).padStart(2, "0")}`;
const txcYmd = (iso) => iso.replaceAll("-", "");

// TXC day groups → GTFS calendar columns.
const TXC_DAYS = {
  Monday: ["monday"], Tuesday: ["tuesday"], Wednesday: ["wednesday"], Thursday: ["thursday"], Friday: ["friday"],
  Saturday: ["saturday"], Sunday: ["sunday"],
  MondayToFriday: ["monday", "tuesday", "wednesday", "thursday", "friday"],
  MondayToSaturday: ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday"],
  MondayToSunday: ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"],
  Weekend: ["saturday", "sunday"],
  NotSaturday: ["monday", "tuesday", "wednesday", "thursday", "friday", "sunday"],
};
// TXC bank-holiday element names → gov.uk event titles (matched by prefix).
const TXC_BANK_HOLIDAYS = {
  NewYearsDay: ["New Year"], Jan2ndScotland: ["2nd January"], GoodFriday: ["Good Friday"],
  EasterMonday: ["Easter Monday"], MayDay: ["Early May"], SpringBank: ["Spring bank"],
  AugustBankHolidayScotland: ["Summer bank"], StAndrewsDay: ["St Andrew"],
  ChristmasDay: ["Christmas Day"], BoxingDay: ["Boxing Day"],
  Christmas: ["Christmas Day", "Boxing Day"],
  // Substitute-day forms: gov.uk titles these "… (substitute day)", so the same prefixes match.
  NewYearsDayHoliday: ["New Year"], Jan2ndScotlandHoliday: ["2nd January"], ChristmasDayHoliday: ["Christmas Day"],
  BoxingDayHoliday: ["Boxing Day"], StAndrewsDayHoliday: ["St Andrew"],
  // No Scottish date: a rule about it changes nothing here.
  LateSummerBankHolidayNotScotland: [],
  AllHolidaysExceptChristmas: ["New Year", "2nd January", "Good Friday", "Easter Monday", "Early May", "Spring bank", "Summer bank", "St Andrew"],
};

// OperatingProfile element → a plain description, or null when absent.
function txcProfile(el) {
  if (!el) return null;
  const prof = { days: new Set(), holidaysOnly: false, in: [], out: [], bankOp: [], bankNon: [] };
  const dow = txcChild(txcChild(el, "RegularDayType"), "DaysOfWeek");
  if (dow) for (const c of dow.children) {
    const cols = TXC_DAYS[c.name];
    if (!cols) throw new Error(`TXC: unknown day group ${c.name}`);
    cols.forEach((d) => prof.days.add(d));
  }
  if (txcChild(txcChild(el, "RegularDayType"), "HolidaysOnly")) prof.holidaysOnly = true;
  const special = txcChild(el, "SpecialDaysOperation");
  for (const [kind, key] of [["DaysOfOperation", "in"], ["DaysOfNonOperation", "out"]]) {
    for (const dr of txcChildren(txcChild(special, kind), "DateRange")) {
      const a = txcText(dr, "StartDate"), b = txcText(dr, "EndDate") || a;
      if (a) prof[key].push([a, b]);
    }
  }
  const bank = txcChild(el, "BankHolidayOperation");
  prof.bankOp = txcAllChildren(txcChild(bank, "DaysOfOperation")).map((c) => c.name);
  prof.bankNon = txcAllChildren(txcChild(bank, "DaysOfNonOperation")).map((c) => c.name);
  return prof;
}
function txcAllChildren(n) { return n ? n.children : []; }

// Signature for grouping journeys that run on identical days into one service.
function txcProfileKey(prof) {
  return JSON.stringify({ d: [...prof.days].sort(), h: prof.holidaysOnly, i: prof.in, o: prof.out, bo: prof.bankOp, bn: prof.bankNon });
}

async function busesFetchNaptan() {
  const res = await fetch(BUSES_NAPTAN_URL, { headers: { "User-Agent": BUSES_UA }, signal: AbortSignal.timeout(60000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} from NaPTAN`);
  const buf = Buffer.from(await res.arrayBuffer());
  const pos = {};
  let header = null, col = null;
  const parser = new CSVParser((cells) => {
    if (!header) {
      header = cells.map((h) => h.replace(/^\uFEFF/, "").trim());
      const find = (want) => header.findIndex((h) => h.toLowerCase() === want.toLowerCase());
      col = { id: find("ATCOCode"), name: find("CommonName"), lat: find("Latitude"), lon: find("Longitude"), e: find("Easting"), n: find("Northing"), status: find("Status") };
      for (const [k, v] of Object.entries(col)) if (v < 0 && k !== "status") throw new Error(`NaPTAN CSV: no ${k} column (header: ${header.slice(0, 12).join(",")}…)`);
      return;
    }
    // The API leaves Latitude/Longitude blank and gives OSGB grid references;
    // take lat/lon when present, otherwise convert Easting/Northing.
    const id = cells[col.id];
    let lat = Number(cells[col.lat]), lon = Number(cells[col.lon]);
    if (!lat || !lon) {
      const E = Number(cells[col.e]), N = Number(cells[col.n]);
      if (!E || !N) return;
      const pt = osgbToWgs84(E, N);
      lat = pt.lat; lon = pt.lng;
    }
    if (!id || !Number.isFinite(lat) || !Number.isFinite(lon)) return;
    pos[id] = { name: cells[col.name] || "", lat, lon, status: col.status >= 0 ? cells[col.status] : "" };
  });
  feedBuffer(buf, parser);
  console.log(`buses: NaPTAN area 617 — ${Object.keys(pos).length} stops with positions`);
  return pos;
}

async function busesFetchBankHolidays() {
  const res = await fetch(BUSES_BANK_HOLIDAYS_URL, { headers: { "User-Agent": BUSES_UA }, signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} from gov.uk bank holidays`);
  const j = await res.json();
  const events = j && j.scotland && j.scotland.events;
  if (!Array.isArray(events) || !events.length) throw new Error("gov.uk bank holidays: no Scotland events");
  return events.map((e) => ({ title: e.title, date: txcYmd(e.date) }));
}

// One TXC feed → the same Largs slice object busesFetchFeed() returns.
async function busesFetchTxcFeed(feed) {
  const res = await fetch(feed.url, { headers: { "User-Agent": BUSES_UA }, signal: AbortSignal.timeout(120000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${feed.url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const entries = unzipEntries(buf).filter((e) => /\.xml$/i.test(e.name));
  if (!entries.length) throw new Error(`${feed.op}: no XML in TXC zip`);
  const [naptan, bankHolidays] = await Promise.all([busesFetchNaptan(), busesFetchBankHolidays()]);
  const ns = (id) => `${feed.op}:${id}`;

  const today = new Date();
  const winStart = txcYmd(new Date(today.getTime() - BUSES_EXCEPTION_DAYS_BACK * 86400000).toISOString().slice(0, 10));
  const winEnd = txcYmd(new Date(today.getTime() + BUSES_EXCEPTION_DAYS_AHEAD * 86400000).toISOString().slice(0, 10));
  const eachDay = (a, b, fn) => {
    const lo = a > winStart ? a : winStart, hi = b < winEnd ? b : winEnd;
    for (let d = lo; d <= hi;) {
      fn(d);
      const t = new Date(Date.UTC(+d.slice(0, 4), +d.slice(4, 6) - 1, +d.slice(6, 8)) + 86400000);
      d = txcYmd(t.toISOString().slice(0, 10));
    }
  };

  const stopInfo = {};       // atco → { name, lat, lon }
  const trips = {}, routes = {}, calendar = [], calendarDates = [], calls = [];
  let feedStart = "99999999", feedEnd = "00000000", journeysTotal = 0, journeysNoProfile = 0;
  const unknownBank = new Set();

  for (const entry of entries) {
    const doc = txcChild(txcParseXml(entry.read().toString("utf8")), "TransXChange");
    if (!doc) throw new Error(`${feed.op}: ${entry.name} is not a TransXChange document`);

    for (const sp of txcChildren(txcChild(doc, "StopPoints"), "AnnotatedStopPointRef")) {
      const id = txcText(sp, "StopPointRef");
      const lat = Number(txcText(sp, "Location", "Latitude")), lon = Number(txcText(sp, "Location", "Longitude"));
      if (id && !stopInfo[id]) stopInfo[id] = { name: txcText(sp, "CommonName"), lat: lat || null, lon: lon || null };
    }
    for (const sp of txcChildren(txcChild(doc, "StopPoints"), "StopPoint")) {
      const id = txcText(sp, "AtcoCode");
      if (id && !stopInfo[id]) stopInfo[id] = { name: txcText(sp, "Descriptor", "CommonName"), lat: null, lon: null };
    }

    const sections = {};
    for (const sec of txcChildren(txcChild(doc, "JourneyPatternSections"), "JourneyPatternSection")) {
      sections[sec.attrs.id] = txcChildren(sec, "JourneyPatternTimingLink").map((l) => ({
        id: l.attrs.id,
        from: txcText(l, "From", "StopPointRef"), to: txcText(l, "To", "StopPointRef"),
        fromAct: txcText(l, "From", "Activity") || "pickUpAndSetDown", toAct: txcText(l, "To", "Activity") || "pickUpAndSetDown",
        fromWait: txcSeconds(txcText(l, "From", "WaitTime")), toWait: txcSeconds(txcText(l, "To", "WaitTime")),
        run: txcSeconds(txcText(l, "RunTime")),
      }));
    }

    const services = {}, patterns = {};
    for (const svc of txcChildren(txcChild(doc, "Services"), "Service")) {
      const code = txcText(svc, "ServiceCode");
      const lines = {};
      for (const ln of txcChildren(txcChild(svc, "Lines"), "Line")) lines[ln.attrs.id] = txcText(ln, "LineName");
      const period = [txcYmd(txcText(svc, "OperatingPeriod", "StartDate")), txcYmd(txcText(svc, "OperatingPeriod", "EndDate")) || "99991231"];
      services[code] = { lines, period, profile: txcProfile(txcChild(svc, "OperatingProfile")), destination: txcText(svc, "StandardService", "Destination") };
      for (const jp of txcChildren(txcChild(svc, "StandardService"), "JourneyPattern")) {
        patterns[jp.attrs.id] = { service: code, display: txcText(jp, "DestinationDisplay"), sections: txcChildren(jp, "JourneyPatternSectionRefs").map((r) => r.text.trim()) };
      }
      if (period[0] && period[0] < feedStart) feedStart = period[0];
      if (period[1] > feedEnd) feedEnd = period[1];
    }

    const journeys = [], byCode = {};
    for (const vj of txcChildren(txcChild(doc, "VehicleJourneys"), "VehicleJourney")) {
      const overrides = {};
      for (const tl of txcChildren(vj, "VehicleJourneyTimingLink")) {
        overrides[txcText(tl, "JourneyPatternTimingLinkRef")] = { run: txcText(tl, "RunTime"), fromWait: txcText(tl, "From", "WaitTime"), toWait: txcText(tl, "To", "WaitTime") };
      }
      const j = {
        code: txcText(vj, "VehicleJourneyCode"), service: txcText(vj, "ServiceRef"), line: txcText(vj, "LineRef"),
        pattern: txcText(vj, "JourneyPatternRef"), ref: txcText(vj, "VehicleJourneyRef"), dep: txcText(vj, "DepartureTime"),
        display: txcText(vj, "DestinationDisplay"), profile: txcProfile(txcChild(vj, "OperatingProfile")), overrides,
      };
      journeys.push(j); byCode[j.code] = j;
    }
    for (const j of journeys) if (!j.pattern && j.ref && byCode[j.ref]) j.pattern = byCode[j.ref].pattern;

    const serviceIds = {};   // profile key → synthetic service id (per TXC service)
    for (const j of journeys) {
      journeysTotal++;
      const svc = services[j.service];
      const pat = patterns[j.pattern];
      if (!svc || !pat) continue;
      const prof = j.profile || svc.profile;
      if (!prof) { journeysNoProfile++; continue; }

      // Service = one calendar row per distinct profile within this TXC service.
      const key = txcProfileKey(prof);
      let sid = serviceIds[key];
      if (!sid) {
        sid = ns(`${j.service}:p${Object.keys(serviceIds).length + 1}`);
        serviceIds[key] = sid;
        const row = { service_id: sid, start_date: svc.period[0], end_date: svc.period[1] };
        for (const d of ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]) row[d] = prof.days.has(d) && !prof.holidaysOnly ? "1" : "0";
        calendar.push(row);
        for (const [a, b] of prof.in) eachDay(a.replaceAll("-", ""), b.replaceAll("-", ""), (d) => calendarDates.push({ service_id: sid, date: d, exception_type: "1" }));
        for (const [a, b] of prof.out) eachDay(a.replaceAll("-", ""), b.replaceAll("-", ""), (d) => calendarDates.push({ service_id: sid, date: d, exception_type: "2" }));
        const bankDates = (names) => {
          const out = new Set();
          for (const n of names) {
            if (n === "AllBankHolidays") { bankHolidays.forEach((h) => out.add(h.date)); continue; }
            const prefixes = TXC_BANK_HOLIDAYS[n];
            if (!prefixes) { unknownBank.add(n); continue; }
            for (const h of bankHolidays) if (prefixes.some((pfx) => h.title.startsWith(pfx))) out.add(h.date);
          }
          return [...out].filter((d) => d >= winStart && d <= winEnd && d >= svc.period[0] && d <= svc.period[1]);
        };
        for (const d of bankDates(prof.bankNon)) calendarDates.push({ service_id: sid, date: d, exception_type: "2" });
        for (const d of bankDates(prof.bankOp)) calendarDates.push({ service_id: sid, date: d, exception_type: "1" });
      }

      // Walk the pattern: running-sum times, both wait sides counted.
      const links = pat.sections.flatMap((sref) => sections[sref] || []);
      if (!links.length) continue;
      const val = (l, k) => { const ov = j.overrides[l.id]; return ov && ov[k] ? txcSeconds(ov[k]) : l[k]; };
      let t = txcClockSeconds(j.dep);
      const walked = [{ stop: links[0].from, arr: t, dep: t, act: links[0].fromAct }];
      for (const l of links) {
        walked[walked.length - 1].dep += val(l, "fromWait");
        const arr = walked[walked.length - 1].dep + val(l, "run");
        walked.push({ stop: l.to, arr, dep: arr + val(l, "toWait"), act: l.toAct });
      }

      const tripId = ns(`${j.service}:${j.code}`);
      const routeId = ns(j.line || Object.keys(svc.lines)[0] || j.service);
      routes[routeId] = svc.lines[j.line] || Object.values(svc.lines)[0] || "?";
      let last = -1;
      walked.forEach((c, i) => { if (c.act !== "pass") last = i; });
      trips[tripId] = { route: routeId, service: sid, headsign: j.display || pat.display || svc.destination || "", last, op: feed.op };
      walked.forEach((c, i) => {
        if (c.act === "pass") return;
        calls.push({ trip: tripId, stop: c.stop, seq: i, time: txcHms(i === last ? c.arr : c.dep), pickup: c.act === "setDown" ? "1" : "0" });
      });
    }
  }
  if (unknownBank.size) console.log(`buses: ${feed.op} — unknown bank-holiday elements ignored: ${[...unknownBank].join(", ")}`);
  if (journeysNoProfile) console.log(`buses: ${feed.op} — ${journeysNoProfile} journeys with no operating profile skipped`);

  // Positions: the file's own if it has them, otherwise NaPTAN; then the box.
  const unplaced = [];
  const stops = [];
  for (const [id, info] of Object.entries(stopInfo)) {
    let { lat, lon, name } = info;
    if (!(lat && lon) && naptan[id]) { lat = naptan[id].lat; lon = naptan[id].lon; name = name || naptan[id].name; }
    if (!(lat && lon)) { unplaced.push(id); continue; }
    if (lat >= BUSES_BOX.latMin && lat <= BUSES_BOX.latMax && lon >= BUSES_BOX.lonMin && lon <= BUSES_BOX.lonMax) stops.push({ id, name, lat, lon });
  }
  if (unplaced.length) console.log(`buses: ${feed.op} — ${unplaced.length} stops with no position (not in NaPTAN 617): ${unplaced.slice(0, 8).join(", ")}${unplaced.length > 8 ? "…" : ""}`);
  if (!stops.length) throw new Error(`${feed.op}: no stops placed inside the Largs box — NaPTAN or feed changed`);
  const stopIds = new Set(stops.map((s) => s.id));
  const largsCalls = calls.filter((c) => stopIds.has(c.stop));
  const largsTrips = new Set(largsCalls.map((c) => c.trip));
  for (const id of Object.keys(trips)) if (!largsTrips.has(id)) delete trips[id];

  console.log(`buses: ${feed.op} TXC (${(buf.length / 1048576).toFixed(1)} MB, ${entries.length} files) — ${stops.length} Largs stops, ${Object.keys(trips).length} of ${journeysTotal} journeys calling, feed ${feedStart}–${feedEnd}`);
  return { op: feed.op, bytes: buf.length, start: feedStart, end: feedEnd, stops, trips, routes, calendar, calendarDates, calls: largsCalls };
}

// All feeds → one slice. Stops merge by NaPTAN code (first feed's name
// wins); everything else is already namespaced, so it concatenates.
// All-or-nothing: if any feed fails the previous cached slice is kept.
async function busesFetchSlice() {
  const parts = [];
  for (const feed of BUSES_FEEDS) parts.push(await (feed.format === "txc" ? busesFetchTxcFeed(feed) : busesFetchFeed(feed)));

  const stopsById = {};
  for (const p of parts) for (const st of p.stops) if (!stopsById[st.id]) stopsById[st.id] = st;
  const stops = Object.values(stopsById);
  if (!stops.some((st) => st.id === BUSES_MAIN_STOP)) throw new Error("Main Street stop missing from feeds — box or feed changed");

  const trips = Object.assign({}, ...parts.map((p) => p.trips));
  const routes = Object.assign({}, ...parts.map((p) => p.routes));
  const calendar = parts.flatMap((p) => p.calendar);
  const calendarDates = parts.flatMap((p) => p.calendarDates);
  const calls = parts.flatMap((p) => p.calls);
  const feeds = Object.fromEntries(parts.map((p) => [p.op, { start: p.start, end: p.end, bytes: p.bytes }]));
  const feedStart = parts.reduce((m, p) => (p.start < m ? p.start : m), "99999999");
  const feedEnd = parts.reduce((m, p) => (p.end > m ? p.end : m), "00000000");
  const bytes = parts.reduce((n, p) => n + p.bytes, 0);

  const slice = {
    schema: BUSES_SCHEMA,
    fetchedAt: new Date().toISOString(),
    feed: { start: feedStart, end: feedEnd, bytes, feeds },
    stops, trips, routes, calendar, calendarDates,
    calls: calls.map((c) => [c.trip, c.stop, c.seq, c.time, c.pickup]),
  };
  try {
    await mkdir(path.dirname(BUSES_CACHE_FILE), { recursive: true });
    await writeFile(BUSES_CACHE_FILE, JSON.stringify(slice) + "\n");
  } catch { /* cache write is best-effort */ }
  console.log(`buses: merged ${parts.length} feeds — ${stops.length} Largs stops, ${Object.keys(trips).length} trips calling`);
  return slice;
}

function busesActiveServices(slice, iso) {
  const ymd = iso.replaceAll("-", "");
  const dow = busesDow(iso);
  const active = new Set();
  for (const r of slice.calendar) {
    if (r.start_date <= ymd && ymd <= r.end_date && r[dow] === "1") active.add(r.service_id);
  }
  let added = 0, removed = 0;
  for (const r of slice.calendarDates) {
    if (r.date !== ymd) continue;
    if (r.exception_type === "1") { active.add(r.service_id); added++; }
    else if (r.exception_type === "2") { active.delete(r.service_id); removed++; }
  }
  return { active, added, removed };
}

function busesClock(min) {
  const h = Math.floor(min / 60) % 24, m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

// stopId -> sorted calls for one service day. m may exceed 1440.
// Headsigns that are just the town's name mean nothing inside the town;
// the trip's last stop is what the reader needs ("Largs" → "Largs Main St").
const BUSES_TOWN = "Largs";
function busesDestinations(slice) {
  const stopName = {};
  for (const st of slice.stops) stopName[st.id] = st.name;
  const dest = {};
  for (const [trip, stop, seq] of slice.calls) {
    const t = slice.trips[trip];
    if (t && seq === t.last && stopName[stop]) dest[trip] = stopName[stop];
  }
  return (trip, headsign) => (headsign === BUSES_TOWN && dest[trip]) ? dest[trip] : headsign;
}

function busesDay(slice, iso) {
  const { active } = busesActiveServices(slice, iso);
  const destination = busesDestinations(slice);
  const byStop = {};
  for (const [trip, stop, seq, time, pickup] of slice.calls) {
    const t = slice.trips[trip];
    if (!t || !active.has(t.service)) continue;
    const [hh, mm] = time.split(":").map(Number);
    const m = hh * 60 + mm;
    (byStop[stop] ||= []).push({
      m, t: busesClock(m),
      route: slice.routes[t.route] || "?",
      to: destination(trip, t.headsign),
      op: t.op,
      term: seq === t.last,
      setdown: pickup === "1",
    });
  }
  for (const list of Object.values(byStop)) list.sort((a, b) => a.m - b.m || (a.route < b.route ? -1 : 1));
  return byStop;
}

async function loadBuses() {
  let slice = null;
  try { slice = JSON.parse(await readFile(BUSES_CACHE_FILE, "utf8")); } catch { /* no cache yet */ }
  if (slice && slice.schema !== BUSES_SCHEMA) {
    console.log("buses: cached slice uses an older schema — refreshing");
    slice = null;
  }
  const ageH = slice ? (Date.now() - Date.parse(slice.fetchedAt)) / 3600000 : Infinity;
  if (!slice || ageH > BUSES_MAX_AGE_H) {
    try {
      slice = await busesFetchSlice();
    } catch (error) {
      if (!slice) throw error;
      console.warn(`buses: keeping ${ageH.toFixed(0)}h-old slice — ${error.message}`);
    }
  }

  const yesterday = busesIsoDay(-1), today = busesIsoDay(0), tomorrow = busesIsoDay(1);
  const dayY = busesDay(slice, yesterday);
  const dayT = busesDay(slice, today);
  const dayN = busesDay(slice, tomorrow);
  const ex = busesActiveServices(slice, today);

  const main = slice.stops.find((s) => s.id === BUSES_MAIN_STOP);
  const dist = (s) => Math.hypot((s.lat - main.lat) * 111, (s.lon - main.lon) * 62);
  const stops = slice.stops.map((s) => {
    const own = dayT[s.id] || [];
    const tail = (dayY[s.id] || []).filter((d) => d.m >= 1440).map((d) => ({ ...d, m: d.m - 1440 }));
    const deps = tail.concat(own);
    const tomorrowAll = dayN[s.id] || [];
    // First / lasts / first-tomorrow / towards, for one operator or for all.
    // A per-operator view must show its own, not everyone's: with only
    // McGill's loaded the difference was invisible.
    const summarise = (keep) => {
      const mine = deps.filter(keep), ownMine = own.filter(keep);
      const lastTo = {};
      for (const d of ownMine) if (!d.term) lastTo[d.to] = d.t;
      const first = tomorrowAll.filter(keep).find((d) => !d.term && d.m < 1440) || null;
      const heads = [...new Set(mine.filter((d) => !d.term).map((d) => d.to))].sort();
      // "First" is the morning's first bus, not last night's after-midnight
      // tail sitting at the top of the list.
      const firstLive = mine.find((d) => !d.term && d.m >= 180) || mine.find((d) => !d.term) || null;
      return {
        towards: heads,
        first: firstLive ? { t: firstLive.t, route: firstLive.route, to: firstLive.to } : null,
        lastTo,
        lastToList: Object.entries(lastTo).map(([to, t]) => ({ to, t })),
        firstTomorrow: first ? { t: first.t, route: first.route, to: first.to } : null,
      };
    };
    const all = summarise(() => true);
    const ops = [...new Set(deps.filter((d) => !d.term).map((d) => d.op))];
    const byOp = Object.fromEntries(ops.map((k) => [k, summarise((d) => d.op === k)]));
    return {
      id: s.id, name: s.name, lat: s.lat, lon: s.lon,
      pinned: BUSES_PINNED.indexOf(s.id),
      km: Number(dist(s).toFixed(2)),
      towards: all.towards,
      ops,
      first: all.first,
      deps: deps.map(({ m, t, route, to, op, term }) => ({ m, t, route, to, op, term })),
      lastTo: all.lastTo,
      lastToList: all.lastToList,
      firstTomorrow: all.firstTomorrow,
      byOp,
    };
  });
  stops.sort((a, b) => {
    const pa = a.pinned < 0 ? 99 : a.pinned, pb = b.pinned < 0 ? 99 : b.pinned;
    return pa - pb || a.km - b.km || (a.name < b.name ? -1 : 1);
  });
  for (const s of stops) delete s.pinned;

  const routeNames = [...new Set(Object.values(slice.routes))].sort();
  const routeOp = {};
  for (const [rid, name] of Object.entries(slice.routes)) routeOp[name] ||= rid.split(":")[0];
  const departures = stops.reduce((n, s) => n + s.deps.filter((d) => !d.term).length, 0);

  return {
    ok: true,
    schema: BUSES_SCHEMA,
    generated: new Date().toISOString(),
    date: today,
    dow: busesDow(today),
    dateLabel: busesDayLabel(today),
    tomorrow: { date: tomorrow, dow: busesDow(tomorrow), label: busesDayLabel(tomorrow) },
    exceptions: { added: ex.added, removed: ex.removed },
    feed: { ...slice.feed, endLabel: busesYmdLabel(slice.feed.end), fetchedAt: slice.fetchedAt },
    operators: BUSES_OPERATORS,
    routes: routeNames.map((n) => ({ n, label: BUSES_ROUTE_LABELS[n] || "", op: routeOp[n] || "mcgills" })),
    views: BUSES_VIEWS,
    departures,
    stops,
  };
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
  out.roadworks = await loadRoadworksDisruptions();
  anySuccess = true;
  console.log(`roadworks: ${out.roadworks.count} active, ${out.roadworks.plannedCount ?? 0} planned in Largs (register data to ${out.roadworks.dataDate})`);
} catch (error) {
  console.warn(`roadworks: keeping previous value — ${error.message}`);
}

/* Buses are a separate data file, not part of today.json: the page needs
 * every call at forty stops (~200 KB), which would swamp the board's data.
 * Same resilience rule — a failed fetch keeps the previous file — with one
 * extra: if there is no previous file at all, write an honest skeleton so
 * the templates that paginate over buses.json still build. */
try {
  const buses = await loadBuses();
  await writeFile(BUSES_FILE, JSON.stringify(buses) + "\n");
  const withdrawn = buses.exceptions.removed ? ` (${buses.exceptions.removed} services withdrawn today)` : "";
  console.log(`buses: ${buses.stops.length} stops, ${buses.departures} departures on ${buses.date}${withdrawn}`);
} catch (error) {
  console.warn(`buses: keeping previous buses.json — ${error.message}`);
  try {
    await readFile(BUSES_FILE, "utf8");
  } catch {
    await writeFile(BUSES_FILE, JSON.stringify({
      ok: false, schema: BUSES_SCHEMA, views: BUSES_VIEWS, operators: BUSES_OPERATORS, routes: [], stops: []
    }) + "\n");
    console.warn("buses: no previous buses.json — wrote an empty skeleton");
  }
}

if (anySuccess) out.fetchedAt = new Date().toISOString();

await writeFile(DATA_FILE, JSON.stringify(out, null, 2) + "\n");
console.log(anySuccess ? "today.json updated" : "no live data reachable — previous values kept");
