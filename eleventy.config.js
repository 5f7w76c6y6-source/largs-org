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

  // Roadworks filters. The date arithmetic lives here rather than in the
  // template because Nunjucks has no clean way to add days to a date, and
  // the workarounds go wrong at month ends. "soon" means: planned, with a
  // registered start date falling within a fortnight of the register's own
  // data date — not of today, because the data is only as fresh as the
  // overnight pull. Works with no registered start date can only ever
  // appear under "all", and the page says so.
  eleventyConfig.addFilter("filterWorks", function (items, view, dataDate) {
    const list = Array.isArray(items) ? items : [];
    if (view === "active") return list.filter((w) => w.status === "active");
    if (view === "nostart") return list.filter((w) => w.status === "planned" && !w.from);
    if (view === "soon") {
      const d = new Date(dataDate + "T12:00:00Z");
      if (isNaN(d)) return [];
      d.setUTCDate(d.getUTCDate() + 14);
      const cutoff = d.toISOString().slice(0, 10);
      // A floor as well as a ceiling. The register's status is the promoter's
      // own phase code, not a date calculation, so a work stays "proposed"
      // until someone moves it — and plenty never get moved. Without the
      // floor, a work that was due to start a fortnight ago still counts as
      // starting soon, which it plainly is not.
      return list.filter(
        (w) => w.status === "planned" && w.from && w.from >= dataDate && w.from <= cutoff
      );
    }
    return list;
  });

  // Cloudflare Pages reads _headers from the build output root, but
  // Eleventy will not copy it on its own — it is not a template. Without
  // this line the file sits in src/ looking correct while every deploy
  // goes out without it. That is exactly what happened between 11 and
  // 13 August 2026: noindex in the repo, absent on the live site.
  // Check it, do not assume it:
  //   curl -sI https://largs-org.pages.dev/ | grep -i x-robots-tag
  eleventyConfig.addPassthroughCopy({ "src/_headers": "_headers" });

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

  // ---- Regular events (classes, clubs, weekly markets) -------------
  // A regular is a FIXTURE, not an event: it is never expanded into
  // dated occurrences and never joins the `upcoming` list. These two
  // filters read events.regulars — one groups them by day for the
  // What's On page, the other picks out today's for the Today board.
  //
  // A regular is "active" only within its term: on or after `from`,
  // on or before `until` (blank means indefinitely), and not on a date
  // listed in `except`. That is what stops the site advertising a class
  // that stopped running in June.

  const WEEKDAYS = ["monday","tuesday","wednesday","thursday","friday","saturday","sunday"];

  function ukToday() {
    const p = ukParts(new Date(), { year: "numeric", month: "2-digit", day: "2-digit" });
    return `${p.year}-${p.month}-${p.day}`;
  }

  function isActive(r, today) {
    if (r.from && r.from > today) return false;
    if (r.until && r.until < today) return false;
    if ((r.except || []).includes(today)) return false;
    return true;
  }

  // regularsToday(regulars) -> those running today, in Largs wall-clock time.
  eleventyConfig.addFilter("regularsToday", (regulars) => {
    const today = ukToday();
    const dow = ukParts(new Date(), { weekday: "long" }).weekday.toLowerCase();
    return (regulars || []).filter(
      (r) => String(r.weekday || "").toLowerCase() === dow && isActive(r, today)
    );
  });

  // regularsByDay(regulars) -> [{ day: "Monday", items: [...] }, ...]
  // Monday first, days with nothing omitted, so the page never renders
  // an empty heading. Only currently-active regulars are included.
  eleventyConfig.addFilter("regularsByDay", (regulars) => {
    const today = ukToday();
    const live = (regulars || []).filter((r) => isActive(r, today));
    return WEEKDAYS.map((day) => ({
      day: day.charAt(0).toUpperCase() + day.slice(1),
      items: live
        .filter((r) => String(r.weekday || "").toLowerCase() === day)
        .sort((a, b) => String(a.time || "").localeCompare(String(b.time || "")))
    })).filter((g) => g.items.length);
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

  // ---- External links open a new tab --------------------------------
  // Site rule, applied at build time so no link can ever be missed:
  // external links (href starting http/https) open in a new tab with
  // rel="noopener"; internal links, anchors and mailtos never do. The
  // reason is the audience: a reader who follows a timetable link and
  // then fights an unfamiliar site's back button loses their place —
  // VesselFinder taught us this, eating two or three taps to return.
  // A new tab keeps Largs exactly where they left it. Links that
  // already carry a target= are left untouched.
  eleventyConfig.addTransform("externalLinks", function (content) {
    if (!(this.page.outputPath || "").endsWith(".html")) return content;
    return content.replace(/<a\s[^>]*>/g, (tag) => {
      if (!/href="https?:\/\//.test(tag)) return tag;
      if (/target=/.test(tag)) return tag;
      return tag.replace(/>$/, ' target="_blank" rel="noopener">');
    });
  });

  return {
    dir: {
      input: "src",
      includes: "_includes",
      output: "_site"
    }
  };
};
