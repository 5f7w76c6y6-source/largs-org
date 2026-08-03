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
 * Timezone rule: GitHub's runners are UTC. The marine request asks for
 * `timeformat=unixtime` (epoch seconds — unambiguous everywhere), and
 * the one place we need "the current hour in Largs" computes it through
 * Intl with an explicit Europe/London timezone. Never call Date methods
 * that depend on the machine's local timezone in this script.
 *
 * ---- Seams for later (each needs an API key, held as a GitHub Actions
 *      secret and read here via process.env — never committed):
 *
 * TODO tides: swap Open-Meteo's ocean model for UKHO Admiralty tidal
 *   predictions (free developer tier). Read the key from
 *   process.env.ADMIRALTY_KEY, look up the Largs station ID from their
 *   station list, and replace loadTides() below. Keep Open-Meteo as the
 *   fallback if the key is absent so local builds still work.
 * TODO ferry: CalMac Largs–Cumbrae service status (no public JSON feed;
 *   fetch and parse their service-status page here, server-side).
 * TODO roadworks: Scottish Road Works Register / Traffic Scotland feed.
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

async function fetchJSON(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(9000) });
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

/* ---------- tides ---------- */
/* Open-Meteo's marine model gives hourly sea level including tides.
 * We find local maxima/minima and sharpen each turning point by
 * fitting a parabola through the three surrounding hourly samples —
 * good to a few minutes. Model data, fine for a glance at the prom;
 * swap in UKHO Admiralty predictions for chart-grade times (see the
 * TODO at the top of this file). */

function tideEvents(timesSeconds, heights) {
  const points = [];
  for (let i = 0; i < timesSeconds.length; i++) {
    if (typeof heights[i] === "number") {
      points.push({ t: timesSeconds[i] * 1000, v: heights[i] });
    }
  }

  const raw = [];
  for (let i = 1; i < points.length - 1; i++) {
    const a = points[i - 1].v;
    const b = points[i].v;
    const c = points[i + 1].v;
    const isMax = b > a && b >= c;
    const isMin = b < a && b <= c;
    if (!isMax && !isMin) continue;

    // Parabola vertex offset in hours, clamped to ±1 sample.
    const denominator = a - 2 * b + c;
    let offset = Math.abs(denominator) > 1e-9 ? (0.5 * (a - c)) / denominator : 0;
    offset = Math.max(-1, Math.min(1, offset));

    raw.push({
      type: isMax ? "High" : "Low",
      t: points[i].t + offset * 3600000,
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

async function loadTides() {
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

  return { ok: true, events: upcoming };
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
  console.log(`tides: next ${out.tides.events[0].type.toLowerCase()} at ${out.tides.events[0].time}`);
} catch (error) {
  console.warn(`tides: keeping previous value — ${error.message}`);
}

if (anySuccess) out.fetchedAt = new Date().toISOString();

await writeFile(DATA_FILE, JSON.stringify(out, null, 2) + "\n");
console.log(anySuccess ? "today.json updated" : "no live data reachable — previous values kept");
