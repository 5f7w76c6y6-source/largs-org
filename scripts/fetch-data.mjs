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
 * TODO roadworks: Scottish Road Works Register open data — daily CSVs
 *   under OGL v3 at https://downloads.srwr.scot/export (no key needed).
 */

import { readFile, writeFile } from "node:fs/promises";
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

/* ---------- main ---------- */

// Start from the previous build's data so a failed source degrades to
// stale rather than blank.
let out = { fetchedAt: null, weather: { ok: false }, tides: { ok: false, events: [] } };
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

if (anySuccess) out.fetchedAt = new Date().toISOString();

await writeFile(DATA_FILE, JSON.stringify(out, null, 2) + "\n");
console.log(anySuccess ? "today.json updated" : "no live data reachable — previous values kept");
