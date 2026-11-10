/* The Cumbrae ferry tile's headline frequency, chosen by date so the
   board flips between CalMac's summer and winter timetables on its own.

   WHY A FILE AND NOT A SENTENCE IN THE TEMPLATE. The sentence was hand-
   written ("Usually every 20 min") with a comment saying RE-CHECK BEFORE
   19 OCT 2026. Nobody did until 3 November: the board told the town the
   summer frequency for two weeks of the winter timetable. A date-bounded
   table makes the switch automatic and, when the table runs out, says so
   rather than carrying the last figure forward — the same discipline as
   events' `until` and the civic band's `expires`.

   Each period is read off CalMac's published timetable PDF for the
   Largs–Cumbrae Slip route; `figure` is the headline, `detail` the
   honest qualifier, `source` the document and its date. Add next year's
   periods as CalMac publishes them (summer usually in March, winter in
   September). The route page always has the current PDF:
   https://www.calmac.co.uk/en-gb/route-information/largs-cumbrae-slip-millport/ */

const PERIODS = [
  {
    from: "2026-03-27", to: "2026-10-18",
    figure: "Usually every 20 min",
    detail: "summer timetable",
    source: "CalMac summer 2026 timetable (PDF of 26 Mar 2026): every 20 minutes 09:30–19:30 Mon–Sat, from 10:00 Sundays; sparser early and late.",
  },
  {
    from: "2026-10-19", to: "2027-03-25",
    figure: "Usually every 40 min",
    // `detail` is two or three words, no more: the tile row is as tall as
    // its tallest tile, and a long line here left Weather and Tides half
    // empty (10 Nov 2026). First and last sailings are kept in `hours`,
    // which the tile does not print; the timetable link has them.
    detail: "winter timetable",
    hours: "first 06:35, last 20:10 from Largs (Sun from 08:15)",
    source: "CalMac winter 2026/27 timetable (PDF of 2 Nov 2026): Largs departures mostly 34–40 minutes apart, one 60-minute gap after 13:40; no sailings 25 Dec and 1 Jan; Sunday timetable on 26 Dec and 2 Jan.",
  },
];

module.exports = () => {
  // Largs wall-clock date, so the flip happens at local midnight and not
  // an hour out either side of the clock change.
  const p = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(new Date()).reduce((o, x) => (o[x.type] = x.value, o), {});
  const today = `${p.year}-${p.month}-${p.day}`;
  const current = PERIODS.find((x) => x.from <= today && today <= x.to) || null;
  const last = PERIODS[PERIODS.length - 1];
  return current
    ? { ok: true, ...current, today }
    : {
        ok: false, today,
        figure: "See timetable",
        detail: `this site's copy of the timetable runs out on ${last.to} — check CalMac`,
        source: null,
      };
};
