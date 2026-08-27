/* Power-cut notices for the Today board -- fetched at build time from
 * the site's own /api/power, which serves the snapshot the largs-power
 * Worker keeps in R2. This module must NEVER fail the build: any
 * problem at all returns {ok:false} and the notice simply is not
 * rendered. Silence claims nothing, which is the correct claim -- the
 * feed omits incidents affecting fewer than five customers, so absence
 * was never an all-clear.
 *
 * SCOPE: the snapshot carries KA28, KA29 and KA30, but the notice shows
 * KA30 only -- the Today board should never raise an alarm about
 * somewhere that is not Largs. Widening to Fairlie or Millport later is
 * a one-line change to SHOW_OUTCODES, not a data change.
 *
 * TIMES: SPEN's stamps carry a +00:00 label on what is actually local
 * clock time (verified twice, 27 Aug 2026), so this module never
 * timezone-converts them. The clock is sliced straight out of the
 * string; the date part is compared literally against today's London
 * date. Our own fetchedAt is a true UTC instant and is formatted
 * properly.
 */

// The site's own origin, for the build-time fetch. largs.scot is the
// canonical host; the pages.dev address still answers and would work
// here too, but this way there is one name for the site everywhere.
const ORIGIN = "https://largs.scot";
const SHOW_OUTCODES = ["KA30"];

function londonToday() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const get = (t) => parts.find((p) => p.type === t).value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/* "2026-08-14T08:36:00+00:00" -> {date:"2026-08-14", clock:"08:36"} --
 * by slicing, never by Date, per the mislabel note above. */
function pick(raw) {
  if (typeof raw !== "string" || raw.length < 16) return null;
  return { date: raw.slice(0, 10), clock: raw.slice(11, 16) };
}

function dayMonth(isoDate) {
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", timeZone: "UTC" })
    .format(new Date(Date.UTC(y, m - 1, d)));
}

module.exports = async function () {
  const off = { ok: false, faults: [], checked: null };
  let data;
  try {
    const res = await fetch(ORIGIN + "/api/power", { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return off;
    data = await res.json();
  } catch {
    return off;
  }
  if (!data || data.ok !== true || data.stale) return off;

  const today = londonToday();
  const faults = (Array.isArray(data.faults) ? data.faults : [])
    .map((f) => {
      const sectors = (f.sectors || []).filter((s) => SHOW_OUTCODES.some((oc) => s.startsWith(oc)));
      if (!sectors.length) return null;
      const rep = pick(f.reported);
      const etr = pick(f.etr);
      return {
        id: f.id,
        area: sectors.join(" & "),
        // A fault reported today reads "since 08:36"; the Cheshire kind
        // that runs for a fortnight reads "since 14 August".
        since: rep ? (rep.date === today ? rep.clock : dayMonth(rep.date)) : null,
        etr: etr ? (etr.date === today ? etr.clock : `${etr.clock} on ${dayMonth(etr.date)}`) : null,
      };
    })
    .filter(Boolean);

  if (!faults.length) return off;

  const at = Date.parse(data.fetchedAt || "");
  const checked = Number.isFinite(at)
    ? new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit",
        hour12: false, timeZone: "Europe/London" }).format(new Date(at))
    : null;

  return { ok: true, faults, checked };
};
