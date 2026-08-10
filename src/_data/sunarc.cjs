/* The daylight arc — the sun's position drawn on the day's dome, computed at
 * build time from the sunrise and sunset already fetched into today.json.
 * Nothing here fetches anything; this file only draws facts the weather tile
 * already states, which is why the tile's badge stays `live`.
 *
 * Geometry: a semicircular dome from (12,40) to (88,40) in a 100x48 viewBox,
 * radius 38. The sun's fraction of the day maps to an angle along it. At
 * night no dot is drawn — the dome still shows the day's daylight span, but
 * a dot would claim the sun is somewhere it is not.
 */

const fs = require("fs");
const path = require("path");

function londonNowMinutes() {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const get = (t) => Number(parts.find((p) => p.type === t).value);
  return (get("hour") % 24) * 60 + get("minute");
}

function hhmmToMinutes(s) {
  if (typeof s !== "string" || !/^\d{2}:\d{2}$/.test(s)) return null;
  const [h, m] = s.split(":").map(Number);
  return h * 60 + m;
}

module.exports = function () {
  let weather;
  try {
    const raw = fs.readFileSync(path.join(__dirname, "today.json"), "utf-8");
    weather = JSON.parse(raw).weather || {};
  } catch {
    return { ok: false };
  }

  const rise = hhmmToMinutes(weather.sunrise);
  const set = hhmmToMinutes(weather.sunset);
  if (rise == null || set == null || set <= rise) return { ok: false };

  const now = londonNowMinutes();
  const frac = (now - rise) / (set - rise);
  const day = frac >= 0 && frac <= 1;

  const angle = Math.PI * Math.min(1, Math.max(0, frac));
  const sunX = Math.round((50 - 38 * Math.cos(angle)) * 10) / 10;
  const sunY = Math.round((40 - 38 * Math.sin(angle)) * 10) / 10;

  return { ok: true, day, sunX, sunY };
};
