/* Eleventy configuration.
 *
 * Eleventy reads everything under src/, runs the templates, and writes
 * plain HTML into _site/. Any JSON file in src/_data/ automatically
 * becomes a global variable in every template ("the data cascade"):
 * src/_data/today.json is available as `today`, events.json as
 * `events`, and so on. That one mechanism is the whole architecture —
 * scripts write JSON, templates read it, the output is static HTML.
 *
 * Every date filter below pins the timezone explicitly. GitHub's
 * build machines run on UTC, so "just format the date" would drift an
 * hour from Largs wall-clock time for half the year. Never format a
 * date in this project without going through one of these filters.
 */

const TZ = "Europe/London";

function toDate(value) {
  return value instanceof Date ? value : new Date(value);
}

// Format a date into named parts (weekday, day, month...) in UK time,
// so we can assemble strings exactly rather than trusting locale
// punctuation defaults.
function ukParts(value, options) {
  const formatter = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, ...options });
  return Object.fromEntries(
    formatter
      .formatToParts(toDate(value))
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value])
  );
}

module.exports = function (eleventyConfig) {
  // Copy src/assets/** to _site/assets/** untouched.
  eleventyConfig.addPassthroughCopy({ "src/assets": "assets" });

  // Evaluated once per build — the masthead dateline and "Updated"
  // stamp come from this, so a page built at 09:17 says 09:17.
  eleventyConfig.addGlobalData("buildTime", () => new Date().toISOString());

  // "15:45"
  eleventyConfig.addFilter("hhmm", (value) => {
    const p = ukParts(value, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
    return `${p.hour}:${p.minute}`;
  });

  // "Monday 3 August 2026"
  eleventyConfig.addFilter("dateLong", (value) => {
    const p = ukParts(value, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
    return `${p.weekday} ${p.day} ${p.month} ${p.year}`;
  });

  // "Tue"
  eleventyConfig.addFilter("dow", (value) => ukParts(value, { weekday: "short" }).weekday);

  // "4"
  eleventyConfig.addFilter("dom", (value) => ukParts(value, { day: "numeric" }).day);

  // "Sep" — en-GB gives "Sept" for September; trim to three letters so
  // every month sits identically in the fixed-width event badge.
  eleventyConfig.addFilter("monthShort", (value) => ukParts(value, { month: "short" }).month.slice(0, 3));

  // Build-time expiry for the events list: keep an item while today
  // (Largs wall-clock, not the build machine's UTC) is on or before
  // its last day — `until` for a multi-day span, otherwise its `date`.
  // The half-hourly rebuild makes yesterday's event disappear on its
  // own; no client JavaScript involved.
  eleventyConfig.addFilter("upcoming", (items) => {
    const p = ukParts(new Date(), { year: "numeric", month: "2-digit", day: "2-digit" });
    const today = `${p.year}-${p.month}-${p.day}`;
    return (items || []).filter((e) => (e.until || e.date) >= today);
  });

  return {
    dir: {
      input: "src",
      includes: "_includes",
      output: "_site"
    }
  };
};
