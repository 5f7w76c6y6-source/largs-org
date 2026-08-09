/* Bin days for Largs — computed at build time, no API, no key, no fetch.
 *
 * The finding this rests on: the three-week grey/blue/purple rotation is in
 * the SAME PHASE across the whole town. Verified 9 August 2026 against eight
 * addresses spanning every collection weekday — Routenburn Road (Mon),
 * Greenock Road and Glen Avenue (Tue), Moorburn Road (Wed), Pencil View (Thu),
 * Hill Street, Bowen Craig and Gallowgate Street (Fri). All eight had grey in
 * the week commencing Monday 10 August 2026.
 *
 * What varies street to street is only the WEEKDAY, never the colour. So this
 * page answers the question people actually forget ("which bin this week?")
 * and sends them to the council's own checker for the question they don't
 * ("what day is my street?").
 *
 * CROSS-CHECKED 9 August 2026 against North Ayrshire's own printed calendars
 * 3A (Routenburn Road) and 3B (Moorburn Road), December 2025 to November 2026.
 * The coloured weeks are IDENTICAL in both, every week of the year — that is
 * what licenses the town-wide claim. No week ever carries two coloured bins.
 * The festive weeks do not break the rotation either: both calendars show grey
 * in the week of 22 December and blue in the week of the 29th, with the red
 * days marking collections that move WITHIN those weeks. So an override is
 * only ever needed for a day-level warning, never a colour correction.
 *
 * The brown bin is a separate round with its own weekday and its own
 * fortnightly phase — Routenburn is a Monday round with brown on Wednesday,
 * Gallowgate a Friday round with brown on Tuesday. Largs is split between the
 * two calendars, exactly one week apart on brown: 3A has it in the week of
 * 10 August 2026, 3B the week after. All eight sampled addresses fit one or
 * the other. Brown also pauses over the festive fortnight, in different weeks
 * for each calendar.
 *
 * ---- EDITING THIS FILE ----
 * Everything you need to change lives in CONFIG below. The two jobs are:
 *   1. Festive weeks — North Ayrshire move collections around Christmas and
 *      New Year and announce it as news, not as data. Add an entry to
 *      `overrides` and the page shows your words instead of the computed
 *      answer for that week. A bin page that is confidently wrong on
 *      27 December is worse than no bin page at all.
 *   2. Re-verification — if the cycle ever slips, check one address on the
 *      council's checker, set `anchorWeek` to a Monday you have confirmed and
 *      `anchorColour` to what goes out that week, and update `verified`.
 */

const CONFIG = {
  // A Monday you have personally confirmed, and the colour collected that week.
  anchorWeek: "2026-08-10",
  anchorColour: "grey",

  // The rotation, in order. Largs runs a three-week cycle.
  cycle: ["grey", "blue", "purple"],

  // Brown is fortnightly and Largs runs in two halves, one week apart. This is
  // the Monday of a week in which calendar 3A has brown; 3B has it the week
  // after. Residents learn which calendar they are on once and it stays.
  brownAnchorWeek: "2026-08-10",
  brownCalendars: { 1: "3A", 2: "3B" },

  // Date this cycle was last checked against the council's own checker.
  verified: "2026-08-09",

  // Weeks where the computed answer must not be shown. `weekStart` is a
  // Monday; `note` replaces the normal wording for that week.
  // Example:
  //   { weekStart: "2026-12-21", note: "Festive collections — dates move this
  //     week. Check the council's own page." }
  overrides: [],

  checkerUrl: "https://www.maps.north-ayrshire.gov.uk/Sites/BinCollections/",
  councilUrl: "https://www.north-ayrshire.gov.uk/bins-litter-and-recycling/bin-collection-days",
};

const COLOURS = {
  grey: { name: "Grey", holds: "General household waste", swatch: "#6E6E6E" },
  blue: { name: "Blue", holds: "Paper, card and cardboard", swatch: "#3A5BC7" },
  purple: { name: "Purple", holds: "Plastics, cans and cartons", swatch: "#6B3FA0" },
  brown: { name: "Brown", holds: "Food and garden waste", swatch: "#7A4A21" },
};

/* Today in Largs, as YYYY-MM-DD. Built from Intl rather than the server's
   clock so a build machine in another timezone still gets the right day. */
function londonToday() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const get = (t) => parts.find((p) => p.type === t).value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/* All date maths happens on UTC midnights, so British Summer Time cannot
   nudge a week boundary by an hour and land us on the wrong Monday. */
function utcDate(ymd) {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function ymd(date) {
  return date.toISOString().slice(0, 10);
}

function mondayOf(date) {
  const d = new Date(date.getTime());
  const shift = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - shift);
  return d;
}

/* Collections run Monday to Friday, so from Saturday onwards "this week" has
   to mean the week ahead — otherwise the page spends every weekend announcing
   bins that went out on Friday. */
function currentBinWeek(ymdString) {
  const today = utcDate(ymdString);
  const monday = mondayOf(today);
  const day = today.getUTCDay();
  return day === 0 || day === 6 ? addDays(monday, 7) : monday;
}

function addDays(date, n) {
  const d = new Date(date.getTime());
  d.setUTCDate(d.getUTCDate() + n);
  return d;
}

function weeksBetween(from, to) {
  return Math.round((to.getTime() - from.getTime()) / (7 * 86400000));
}

function longDate(date) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

function shortDate(date) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  }).format(date);
}

module.exports = function () {
  const anchor = mondayOf(utcDate(CONFIG.anchorWeek));
  const brownAnchor = mondayOf(utcDate(CONFIG.brownAnchorWeek));
  const anchorIndex = CONFIG.cycle.indexOf(CONFIG.anchorColour);
  const overrides = new Map(CONFIG.overrides.map((o) => [o.weekStart, o.note]));

  const weekFor = (monday) => {
    const offset = weeksBetween(anchor, monday);
    const index = (((anchorIndex + offset) % CONFIG.cycle.length) + CONFIG.cycle.length) % CONFIG.cycle.length;
    const key = CONFIG.cycle[index];
    const brownOffset = (((weeksBetween(brownAnchor, monday)) % 2) + 2) % 2;
    return {
      weekStart: ymd(monday),
      startLong: longDate(monday),
      startShort: shortDate(monday),
      endShort: shortDate(addDays(monday, 4)),
      colour: key,
      name: COLOURS[key].name,
      holds: COLOURS[key].holds,
      swatch: COLOURS[key].swatch,
      brownHalf: brownOffset === 0 ? 1 : 2,
      brownCalendar: CONFIG.brownCalendars[brownOffset === 0 ? 1 : 2],
      brownCalendarNext: CONFIG.brownCalendars[brownOffset === 0 ? 2 : 1],
      note: overrides.get(ymd(monday)) || "",
    };
  };

  const thisMonday = currentBinWeek(londonToday());
  const weeks = [0, 1, 2, 3].map((n) => weekFor(addDays(thisMonday, n * 7)));

  return {
    verified: CONFIG.verified,
    checkerUrl: CONFIG.checkerUrl,
    councilUrl: CONFIG.councilUrl,
    colours: COLOURS,
    order: CONFIG.cycle.map((k) => ({ key: k, ...COLOURS[k] })),
    brown: COLOURS.brown,
    brownCalendars: CONFIG.brownCalendars,
    current: weeks[0],
    ahead: weeks.slice(1),
  };
};
