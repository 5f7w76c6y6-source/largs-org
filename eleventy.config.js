/* Node built-ins, for the stylesheet fingerprint below. */
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

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

  /* ---- The stylesheet's fingerprint -------------------------------
   *
   * WHY THIS EXISTS. On 27 August 2026 a CSS change went out and did
   * not appear. The file was correct on the server -- curl proved it
   * byte for byte, identical on both hostnames -- but browsers were
   * holding a PARTIAL copy: Safari had parsed the first 33 lines and
   * nothing after. A purge of Cloudflare's cache did not clear it. Two
   * phones, a Mac and an iPad each behaved differently, and an
   * "Add to Home Screen" icon could only be fixed by deleting and
   * re-adding it. That is not something a resident can be asked to do.
   *
   * A stylesheet at a fixed URL gives you no way to force a refetch.
   * Hashing its contents into the filename does: every change produces
   * a URL no cache anywhere has ever seen, so a stale or truncated
   * entry becomes unreachable rather than merely unlucky. The old
   * name stops being emitted at all.
   *
   * `cssHref` is what the template asks for. The matching output file
   * is created by the passthrough copy below; both read the same
   * hash, so they cannot drift apart.
   *
   * DECLARED HERE, ABOVE THE PASSTHROUGH THAT USES IT. `const` is not
   * hoisted: when this block sat lower in the file, beside buildTime,
   * the passthrough referenced cssHash before it existed and every
   * build died with "Cannot access 'cssHash' before initialization".
   */
  const CSS_SRC = path.join(__dirname, "src", "assets", "css", "site.css");
  const cssHash = crypto
    .createHash("sha256")
    .update(fs.readFileSync(CSS_SRC))
    .digest("hex")
    .slice(0, 10);
  const cssOut = `/assets/css/site.${cssHash}.css`;
  eleventyConfig.addGlobalData("cssHref", cssOut);

  eleventyConfig.addPassthroughCopy({ "src/assets": "assets" });

  /* Cloudflare Pages reads _headers from the site root. See the file
     itself for why the hashed assets are marked immutable. */
  eleventyConfig.addPassthroughCopy({ "src/_headers": "_headers" });
  /* The stylesheet again, under its fingerprinted name. The unhashed
     copy still lands via the line above; nothing links to it, and it
     can be dropped once nothing in the wild is asking for it. */
  eleventyConfig.addPassthroughCopy({
    "src/assets/css/site.css": `assets/css/site.${cssHash}.css`,
  });

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
  // The top line of a What's On date badge, in three states.
  //
  //   FRI       within the week -- one such weekday between here and it
  //   DEC       further off, or a multi-day span
  //   JUN '27   a different calendar year
  //
  // The year matters more than it looks. "JUN 5" read in August 2026 is
  // not just vague, it reads as June just gone -- the wrong direction. The
  // apostrophe is load-bearing too: a bare "JUN 27" reads as the 27th.
  const badgeTop = (date, farOut) =>
    farOut ? ukParts(date, { month: "short" }).month.slice(0, 3)
           : ukParts(date, { weekday: "short" }).weekday;

  // Shown only when the event is not in the current year. "JUN 5" read in
  // August 2026 does not just lack a year -- it reads as June just gone,
  // which is the wrong direction. A "2026" on everything else would be
  // noise, so this is empty far more often than not.
  const badgeYear = (date, thisYear) => {
    const year = String(date).slice(0, 4);
    return year === String(thisYear) ? "" : year;
  };

  // A weekday badge only helps if there is one such weekday between here
  // and the event. Inside a week, "FRI 11" is unambiguous. Beyond it,
  // there are two Fridays and the reader needs the month instead.
  const BADGE_WEEKDAY_WITHIN_DAYS = 7;

  eleventyConfig.addFilter("upcoming", (items) => {
    const p = ukParts(new Date(), { year: "numeric", month: "2-digit", day: "2-digit" });
    const today = `${p.year}-${p.month}-${p.day}`;
    const now = Date.parse(today + "T00:00:00Z");
    return (items || [])
      .filter((e) => (e.until || e.date) >= today)
      // farOut is COMPUTED, never stored. Whether something is far out
      // depends on when you are reading it: a pantomime is months away in
      // August and this Thursday in December, and no field in a data file
      // can be both. Storing it left September showing "FRI 11" with no
      // month directly under an August entry.
      //
      // A span always shows the month: a weekday badge on a nine-day
      // festival names one of its nine days and implies the wrong thing.
      .map((e) => {
        const days = Math.round((Date.parse(e.date + "T00:00:00Z") - now) / 86400000);
        const farOut = Boolean(e.until) || days > BADGE_WEEKDAY_WITHIN_DAYS;
        // Running today. The badge still shows the START date -- on a
        // chronological list that is the useful anchor and the right sort
        // key -- so this carries the fact the badge cannot: that a span
        // which began days ago has not been missed. Same test todayOnly
        // uses, and it cannot express a gap: an event running weekdays
        // only would be marked on now on a Saturday. If one is ever
        // listed, give it separate dated entries rather than a span.
        const onNow = e.date <= today && (e.until || e.date) >= today;
        return Object.assign({}, e, { farOut, onNow, badgeTop: badgeTop(e.date, farOut), badgeYear: badgeYear(e.date, p.year) });
      });
  });

  // todayOnly: events whose date is exactly today (or a multi-day span
  // that includes today — date <= today <= until).
  eleventyConfig.addFilter("todayOnly", (items) => {
    const p = ukParts(new Date(), { year: "numeric", month: "2-digit", day: "2-digit" });
    const today = `${p.year}-${p.month}-${p.day}`;
    return (items || [])
      .filter((e) => e.date <= today && (e.until || e.date) >= today)
      // Today by definition -- so the badge is built from TODAY, not from
      // e.date. For a one-day event those are the same; for a multi-day
      // span they are not, and badging the start date printed a day that
      // had already passed under a heading that says "On today".
      //
      // Note this deliberately does not use `until`: an end date only
      // describes an unbroken run, so an event that skips weekends would
      // make an "until" badge wrong. The shape of the run is carried by
      // the human-written `time` string instead.
      .map((e) => Object.assign({}, e, {
        farOut: false,
        badgeTop: ukParts(new Date(), { weekday: "short" }).weekday,
        badgeDom: ukParts(new Date(), { day: "numeric" }).day,
      }));
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

  // A regular whose term starts within the next ten weeks is shown on the
  // What's On page with a "starts …" note rather than hidden: September
  // is when people choose classes, and hiding them until day one is the
  // wrong kind of careful. The Today board still waits for the real start.
  const STARTS_SOON_DAYS = 70;
  function startsSoon(r, today) {
    if (!r.from || r.from <= today) return false;
    const limit = new Date(today + "T00:00:00Z");
    limit.setUTCDate(limit.getUTCDate() + STARTS_SOON_DAYS);
    return r.from <= limit.toISOString().slice(0, 10);
  }
  function startsLabel(iso) {
    const d = new Date(iso + "T12:00:00Z");
    return "starts " + d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "Europe/London" });
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
    const live = (regulars || [])
      .filter((r) => isActive(r, today) || startsSoon(r, today))
      .map((r) => (startsSoon(r, today) ? { ...r, startsLabel: startsLabel(r.from) } : r));
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
