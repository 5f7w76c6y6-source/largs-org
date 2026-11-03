/* SEPA bathing-water classification for Largs (Pencil Beach), for the
   Dookers' board. Date-bounded like ferry.cjs: the classification is set
   each November for the following season from four years of samples, and
   the season runs 15 May to 15 September, during which SEPA post a daily
   water-quality forecast by 10:00. Out of season the tile says when the
   forecast returns rather than carrying a summer line into winter.

   Maintenance: when SEPA publish the next classification (usually mid
   November) add a row to GRADES. If the table runs out the tile says so.
   Source: https://bathingwaters.sepa.org.uk/classifications
   Daily forecasts: https://bathingwaters.sepa.org.uk/predictions/ (no
   machine-readable feed found as of 3 Nov 2026 — the tile links instead). */

const SITE = "Pencil Beach";
const GRADES = [
  { year: 2026, grade: "Excellent", source: "SEPA classifications for 2026, published 18 Nov 2025" },
];
const SEASON = { from: "05-15", to: "09-15" };
const URL = "https://bathingwaters.sepa.org.uk/locations-and-results/results/?location=472272";
const FORECAST_URL = "https://bathingwaters.sepa.org.uk/predictions/";

module.exports = () => {
  const p = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(new Date()).reduce((o, x) => (o[x.type] = x.value, o), {});
  const year = Number(p.year);
  const md = `${p.month}-${p.day}`;
  const inSeason = SEASON.from <= md && md <= SEASON.to;
  const row = GRADES.find((g) => g.year === year) || null;
  const seasonLine = inSeason
    ? `bathing season · SEPA posts a daily water-quality forecast by 10:00 — <a href="${FORECAST_URL}">today's forecast →</a>`
    : `daily forecast returns 15 May`;
  return row
    ? { ok: true, site: SITE, year, grade: row.grade, inSeason, seasonLine, url: URL, forecastUrl: FORECAST_URL }
    : { ok: false, site: SITE, year, grade: "see SEPA", inSeason, seasonLine: `this site's table has no classification for ${year} yet`, url: URL, forecastUrl: FORECAST_URL };
};
