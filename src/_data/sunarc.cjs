/* The daylight circle — the whole day drawn as a clock face, computed at
 * build time from the sunrise and sunset already fetched into today.json.
 * Nothing here fetches anything; this file only draws facts the weather
 * tile already states, which is why the tile's badge stays `live`.
 *
 * Geometry: a full circle, NOON AT THE TOP, midnight at the bottom. Each
 * hour is 15 degrees. The sky-coloured portion runs from sunrise-angle to
 * sunset-angle, so its width IS the day's share of daylight: fat in June,
 * a sliver in December. The boundaries between the two portions are
 * sunrise and sunset themselves — no separate markers needed. The sun
 * rides the rim at the current time's angle; at night the dot crosses
 * the dark portion, drawn pale rather than yellow, because a yellow sun
 * at midnight would be a lie.
 *
 * SVG cannot draw a 360-degree arc in one path, and the large-arc flag
 * flips whenever a portion exceeds 180 degrees (the day arc does every
 * summer, the night arc every winter) — so the path strings are built
 * here, where the trig lives, and the template just prints them.
 */

const fs = require("fs");
const path = require("path");

const CX = 50, CY = 50, R = 38;   // 100x100 viewBox

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

// Minutes since midnight -> point on the rim. Noon (720) is at the top;
// midnight at the bottom. SVG angles: top is -90deg.
function pointAt(minutes) {
  const deg = ((minutes - 720) / 1440) * 360 - 90;
  const rad = (deg * Math.PI) / 180;
  return {
    x: Math.round((CX + R * Math.cos(rad)) * 10) / 10,
    y: Math.round((CY + R * Math.sin(rad)) * 10) / 10,
  };
}

// Arc from minute a to minute b, clockwise (the direction time moves on
// this face). The large-arc flag is 1 when the span exceeds 12 hours.
function arcPath(a, b) {
  const p1 = pointAt(a);
  const p2 = pointAt(b);
  const span = (b - a + 1440) % 1440;
  const large = span > 720 ? 1 : 0;
  return `M ${CX} ${CY} L ${p1.x} ${p1.y} A ${R} ${R} 0 ${large} 1 ${p2.x} ${p2.y} Z`;
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
  const day = now >= rise && now <= set;
  const sun = pointAt(now);

  return {
    ok: true,
    day,
    sunX: sun.x,
    sunY: sun.y,
    dayPath: arcPath(rise, set),    // the sky, sunrise round to sunset
    nightPath: arcPath(set, rise),  // the dark, sunset round to sunrise
  };
};
