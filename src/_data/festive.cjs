/* The festive dressing: on between two dates, off otherwise, by itself.
 *
 * While it is on:
 *   - <body> carries class "festive" (lights along the masthead, snow on
 *     the hills: site.css, FESTIVE DRESSING);
 *   - any picture that has a festive twin in src/assets/img/festive/ is
 *     swapped for it by the `fx` filter (eleventy.config.js). Same file
 *     name, same pixel size, so nothing on the page moves.
 * When it is off none of that is in the built site at all.
 * (A Christmas in Largs page was mocked up on 25 Nov 2026 and held back
 * until its contents are agreed; it is not part of this.)
 *
 * Decided at build time from the date in Largs, like every other dated
 * thing on the site; the site is rebuilt every 15 minutes, so it starts and
 * stops within a quarter of an hour of midnight with nothing to remember.
 *
 * To see it out of season:  FESTIVE=1 npx @11ty/eleventy --serve
 * To force it off:          FESTIVE=0
 *
 * Next year: change the two dates. The pictures stay.
 */
const fs = require("fs");
const path = require("path");

const CONFIG = {
  from: "2026-11-25",   // first day on (Ian, 25 Nov: the shops already have theirs up)
  until: "2027-01-05",  // last day on
};

function largsToday() {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}

module.exports = function () {
  const today = largsToday();
  let on = today >= CONFIG.from && today <= CONFIG.until;
  if (process.env.FESTIVE === "1") on = true;
  if (process.env.FESTIVE === "0") on = false;
  const dir = path.join(__dirname, "..", "assets", "img", "festive");
  let files = [];
  try { files = fs.readdirSync(dir).filter((f) => /\.(png|svg|jpg)$/.test(f)); } catch (e) { /* no folder, no swaps */ }
  return { on, from: CONFIG.from, until: CONFIG.until, files };
};
