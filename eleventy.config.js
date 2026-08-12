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

  // "August 2026" — used to group the photo gallery by month.
  eleventyConfig.addFilter("monthYear", (value) => {
    const p = ukParts(value, { month: "long", year: "numeric" });
    return `${p.month} ${p.year}`;
  });

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

  // todayOnly: events whose date is exactly today (or a multi-day span
  // that includes today — date <= today <= until).
  eleventyConfig.addFilter("todayOnly", (items) => {
    const p = ukParts(new Date(), { year: "numeric", month: "2-digit", day: "2-digit" });
    const today = `${p.year}-${p.month}-${p.day}`;
    return (items || []).filter((e) => e.date <= today && (e.until || e.date) >= today);
  });

  // ---- Issue register filters -------------------------------------
  // The register spans a year, so the Council corner pages need to slice
  // it three ways: by status (the filter pages), by meeting date (the
  // hub shows only the newest minutes), and newest first everywhere.
  // All three run at build time — the filter pages are real HTML files,
  // so they are bookmarkable and work with no client JavaScript.

  // byStatus(items, "completed") -> only completed items.
  // An empty status returns everything, which is how the "All items"
  // page is generated from the same template as the others.
  eleventyConfig.addFilter("byStatus", (items, status) => {
    if (!status) return items || [];
    return (items || []).filter((i) => i.status === status);
  });

  // recordedAt(items, "2025-11-20") -> items whose last mention was at
  // that meeting. Dates are plain ISO strings compared as strings, so
  // no timezone is involved and none of the date filters apply.
  eleventyConfig.addFilter("recordedAt", (items, date) =>
    (items || []).filter((i) => i.lastRecorded === date)
  );

  // currentNotices(items) -> public safety notices live today, in Largs
  // wall-clock time. Same build-time expiry discipline as `upcoming` for
  // events: the half-hourly rebuild drops a notice the day after it
  // expires with no client JavaScript and nothing to remember to remove.
  // Returns at most one — a stack of banners is wallpaper.
  eleventyConfig.addFilter("currentNotices", (items) => {
    const p = ukParts(new Date(), { year: "numeric", month: "2-digit", day: "2-digit" });
    const today = `${p.year}-${p.month}-${p.day}`;
    return (items || [])
      .filter((n) => (n.starts || today) <= today && (n.expires || today) >= today)
      .slice(0, 1);
  });

  // monthsBetween("2025-11-20", "2026-06-18") -> 6
  // Whole months between two ISO dates, used to decide whether an item's
  // last mention is far enough behind the newest minutes to warrant the
  // staleness line on its card. Computed at build time from the data that
  // is already there, so it can never itself go stale: an item that was
  // current last month becomes stale on its own as later minutes arrive,
  // with nothing to remember and nothing to maintain.
  eleventyConfig.addFilter("monthsBetween", (from, to) => {
    if (!from || !to) return 0;
    const [fy, fm] = String(from).split("-").map(Number);
    const [ty, tm] = String(to).split("-").map(Number);
    return (ty - fy) * 12 + (tm - fm);
  });

  // newestFirst(items) -> sorted by last recorded, most recent first.
  // Copies before sorting: Array.prototype.sort mutates, and mutating
  // the data cascade would leak the order into every other template.
  eleventyConfig.addFilter("newestFirst", (items) =>
    [...(items || [])].sort((a, b) =>
      String(b.lastRecorded).localeCompare(String(a.lastRecorded))
    )
  );

  return {
    dir: {
      input: "src",
      includes: "_includes",
      output: "_site"
    }
  };
};
