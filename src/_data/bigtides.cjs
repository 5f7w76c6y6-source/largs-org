/* Big tides ahead — for the Flood watch page. Pure astronomy, computed at
   build time, no data source: the dates of every new and full moon for
   the coming year, each paired with the Moon's nearest perigee (closest
   approach). Spring tides follow each new and full moon by a day or two
   on the Clyde; the biggest come when perigee falls within a day or so of
   the moon ("perigean springs" — "king tides" in the Pacific press),
   bigger still near the equinoxes.

   WHAT THIS IS NOT. The tide alone has never flooded Largs; the prom
   floods when a surge and an onshore gale sit on top of a big tide, and
   the weather is unknowable a year out. So these are the dates when the
   sea starts highest and the margin is thinnest — never dates when
   flooding is expected. SEPA say that, days ahead, when the weather is
   known (flood-notice.njk). Nor are there heights here: heights need
   UKHO's harmonic data, which this site does not hold.

   HIGH-WATER TIMES. A port's spring-tide high water falls at nearly the
   same clock time every cycle (the old "establishment of the port"). For
   Largs it is within about half an hour of midday and midnight GMT — read
   off the Fairlie-channel ocean model for the new moon of 9 November 2026
   (highs at 12:00 and 00:00 on the 9th/10th; Ian, 3 Nov 2026). Rows say
   "about", and add an hour in British Summer Time.

   Method: Meeus, Astronomical Algorithms (2nd ed.), ch. 49 (phases of the
   Moon, full periodic terms, planetary terms omitted: error under half an
   hour) and ch. 50 (perigee, leading periodic terms: error of an hour or
   two, fine for a gap measured in days). Times are UT; dates are shown in
   Largs clock time by the templates. */

const RAD = Math.PI / 180;
const sin = (deg) => Math.sin(deg * RAD);

function jdeToDate(jde) {
  // JDE → JS Date (UT; the TT–UT difference is ~70 s, ignored).
  return new Date((jde - 2440587.5) * 86400000);
}

// ---- Phases (ch. 49). k integer = new moon, k + 0.5 = full moon.
function phaseJDE(k) {
  const T = k / 1236.85;
  let jde = 2451550.09766 + 29.530588861 * k + 0.00015437 * T * T - 0.000000150 * T ** 3 + 0.00000000073 * T ** 4;
  const E = 1 - 0.002516 * T - 0.0000074 * T * T;
  const M = 2.5534 + 29.10535670 * k - 0.0000014 * T * T - 0.00000011 * T ** 3;
  const Mp = 201.5643 + 385.81693528 * k + 0.0107582 * T * T + 0.00001238 * T ** 3 - 0.000000058 * T ** 4;
  const F = 160.7108 + 390.67050284 * k - 0.0016118 * T * T - 0.00000227 * T ** 3 + 0.000000011 * T ** 4;
  const Om = 124.7746 - 1.56375588 * k + 0.0020672 * T * T + 0.00000215 * T ** 3;
  const full = Math.abs(k - Math.floor(k) - 0.5) < 0.01;
  const c = full
    ? [-0.40614, 0.17302, 0.01614, 0.01043, -0.00734, -0.00515, 0.00209]
    : [-0.40720, 0.17241, 0.01608, 0.01039, -0.00739, -0.00514, 0.00208];
  jde += c[0] * sin(Mp) + c[1] * E * sin(M) + c[2] * sin(2 * Mp) + c[3] * sin(2 * F)
    + c[4] * E * sin(Mp - M) + c[5] * E * sin(Mp + M) + c[6] * E * E * sin(2 * M)
    - 0.00111 * sin(Mp - 2 * F) - 0.00057 * sin(Mp + 2 * F) + 0.00056 * E * sin(2 * Mp + M)
    - 0.00042 * sin(3 * Mp) + 0.00042 * E * sin(M + 2 * F) + 0.00038 * E * sin(M - 2 * F)
    - 0.00024 * E * sin(2 * Mp - M) - 0.00017 * sin(Om) - 0.00007 * sin(Mp + 2 * M)
    + 0.00004 * sin(2 * Mp - 2 * F) + 0.00004 * sin(3 * M) + 0.00003 * sin(Mp + M - 2 * F)
    + 0.00003 * sin(2 * Mp + 2 * F) - 0.00003 * sin(Mp + M + 2 * F) + 0.00003 * sin(Mp - M + 2 * F)
    - 0.00002 * sin(Mp - M - 2 * F) - 0.00002 * sin(3 * Mp + M) + 0.00002 * sin(4 * Mp);
  return jde;
}

// ---- Perigee (ch. 50). k integer = perigee.
const PERIGEE_TERMS = [
  [2, 0, 0, -1.6769], [4, 0, 0, 0.4589], [6, 0, 0, -0.1856], [8, 0, 0, 0.0883],
  [2, -1, 0, -0.0773, 0.00019], [0, 1, 0, 0.0502, -0.00013], [10, 0, 0, -0.0460],
  [4, -1, 0, 0.0422, -0.00011], [6, -1, 0, -0.0256], [12, 0, 0, 0.0253], [1, 0, 0, 0.0237],
  [8, -1, 0, 0.0162], [14, 0, 0, -0.0145], [0, 0, 2, 0.0129], [3, 0, 0, -0.0112],
  [10, -1, 0, -0.0104], [16, 0, 0, 0.0086], [12, -1, 0, 0.0069], [5, 0, 0, 0.0066],
  [2, 0, 2, -0.0053], [18, 0, 0, -0.0052], [14, -1, 0, -0.0046], [7, 0, 0, -0.0041],
  [2, 1, 0, 0.0040], [20, 0, 0, 0.0032], [1, 1, 0, -0.0032], [16, -1, 0, 0.0031],
  [4, 1, 0, -0.0029], [9, 0, 0, 0.0027], [4, 0, 2, 0.0027], [2, -2, 0, -0.0027],
  [4, -2, 0, 0.0024], [6, -2, 0, -0.0021], [22, 0, 0, -0.0021], [18, -1, 0, -0.0021],
  [6, 1, 0, 0.0019], [11, 0, 0, -0.0018], [8, 1, 0, -0.0014], [4, 0, -2, -0.0014],
  [6, 0, 2, -0.0014], [3, 1, 0, 0.0014], [5, 1, 0, -0.0014], [13, 0, 0, 0.0013],
  [20, -1, 0, 0.0013], [3, 2, 0, 0.0011],
];
function perigeeJDE(k) {
  const T = k / 1325.55;
  let jde = 2451534.6698 + 27.55454989 * k - 0.0006691 * T * T - 0.000001098 * T ** 3 + 0.0000000052 * T ** 4;
  const D = 171.9179 + 335.9106046 * k - 0.0100383 * T * T - 0.00001156 * T ** 3 + 0.000000055 * T ** 4;
  const M = 347.3477 + 27.1577721 * k - 0.000813 * T * T - 0.000001 * T ** 3;
  const F = 316.6109 + 364.5287911 * k - 0.0125053 * T * T - 0.0000148 * T ** 3;
  for (const [d, m, f, c, ct] of PERIGEE_TERMS) jde += (c + (ct || 0) * T) * sin(d * D + m * M + f * F);
  return jde;
}

function isBST(date) {
  // London offset for this instant: BST if a UTC midnight reads 01:00.
  const h = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", hourCycle: "h23" })
    .format(new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0)));
  return h === "01";
}
function londonParts(date) {
  return new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(date).reduce((o, x) => (o[x.type] = x.value, o), {});
}

module.exports = () => {
  const now = new Date();
  const year = now.getUTCFullYear() + (now.getUTCMonth() + 1) / 12;
  const horizonMs = now.getTime() + 370 * 86400000;

  // Every new and full moon from a month ago to a year ahead.
  const phases = [];
  const k0 = Math.floor((year - 2000) * 12.3685) - 2;
  for (let k = k0; k < k0 + 30; k += 0.5) {
    const when = jdeToDate(phaseJDE(k));
    if (when.getTime() < now.getTime() - 3 * 86400000 || when.getTime() > horizonMs) continue;
    phases.push({ when, phase: Math.abs(k - Math.floor(k) - 0.5) < 0.01 ? "full" : "new" });
  }
  // Every perigee over a slightly wider window.
  const perigees = [];
  const kp0 = Math.floor((year - 1999.97) * 13.2555) - 2;
  for (let k = kp0; k < kp0 + 18; k++) perigees.push(jdeToDate(perigeeJDE(k)));

  const events = phases.map((p) => {
    let best = null;
    for (const pg of perigees) {
      const gap = (pg.getTime() - p.when.getTime()) / 3600000;
      if (best === null || Math.abs(gap) < Math.abs(best.gap)) best = { gap, perigee: pg };
    }
    const gapH = Math.abs(best.gap);
    // Spring tides on the Clyde peak a day or two after the moon.
    const peakFrom = new Date(p.when.getTime() + 1 * 86400000);
    const peakTo = new Date(p.when.getTime() + 2 * 86400000);
    const lp = londonParts(p.when);
    const doy = (Date.UTC(+lp.year, +lp.month - 1, +lp.day) - Date.UTC(+lp.year, 0, 1)) / 86400000;
    const nearEquinox = Math.min(Math.abs(doy - 79), Math.abs(doy - 265)) <= 25; // ~20 Mar, ~22 Sep
    const cls = gapH <= 30 ? "king" : gapH <= 72 ? "big" : "spring";
    return {
      when: p.when.toISOString(), phase: p.phase, perigee: best.perigee.toISOString(),
      gapHours: Math.round(gapH), cls, nearEquinox,
      peakFrom: peakFrom.toISOString(), peakTo: peakTo.toISOString(),
      label: cls === "king" ? "King tides" : cls === "big" ? "Big spring tides" : "Spring tides",
      hwText: isBST(peakFrom) ? "about 01:00 and 13:00" : "about midnight and midday",
      why: cls === "king"
        ? `${p.phase === "full" ? "Full" : "New"} moon with the Moon at its closest ${gapH < 1 ? "the same hour" : `${Math.round(gapH)} h ${best.gap > 0 ? "later" : "earlier"}`}${nearEquinox ? " — and near the equinox, the year's largest" : ""}`
        : cls === "big"
          ? `${p.phase === "full" ? "Full" : "New"} moon; the Moon's closest approach ${Math.round(gapH / 24)} day${Math.round(gapH / 24) === 1 ? "" : "s"} ${best.gap > 0 ? "later" : "earlier"}${nearEquinox ? " — near the equinox" : ""}`
          : `${p.phase === "full" ? "Full" : "New"} moon${nearEquinox ? " near the equinox" : ""}`,
    };
  }).filter((e) => Date.parse(e.peakTo) >= now.getTime());

  return {
    generated: now.toISOString(),
    events,                                       // every spring tide, in order
    notable: events.filter((e) => e.cls !== "spring"), // the ones worth a line
    next: events.find((e) => e.cls !== "spring") || null,
  };
};
