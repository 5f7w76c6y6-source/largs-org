/* On the council's agenda — build-time shaping, from two sources.
 *
 *   data/meetings.json      every scheduled meeting, from the council's own
 *                           committee pages. Knows about meetings months
 *                           ahead whose papers do not exist yet.
 *   data/largs-agenda.json  which meetings have papers mentioning Largs,
 *                           from the council's document search.
 *
 * WHY BOTH. The search can only see documents, so it cannot know a meeting
 * is happening until its papers are lodged — three days beforehand. The
 * calendar knows the date months out but nothing about content. Merging
 * them lets a row say which of three things is true, where a single source
 * would have made all three look alike:
 *
 *   mentioned   papers are published and Largs appears in them
 *   nothing     papers are published and Largs does not appear
 *   awaited     papers are not published yet
 *
 * The union is taken, not the intersection. Each committee page shows its
 * own window — mostly forthcoming, but Local Review Body reaches back to
 * 2024 — so the search holds older meetings the calendar has dropped, and
 * the calendar holds future ones the search cannot see.
 *
 * SCHEDULED MEETINGS LIVE ON THEIR OWN PAGE. Twenty-eight rows each saying
 * "papers not published yet" made half the main page carry no information,
 * and a repeated phrase teaches the eye to skip — which would hide the one
 * row that mattered. They are grouped by month at /on-the-agenda/scheduled/
 * instead, a real page on the same build-time pattern as the register's
 * filters, not a tab: bookmarkable, indexable, no JavaScript.
 *
 * The horizon is whatever the council currently publishes, which is why
 * `scheduledTo` is reported rather than assumed. In January the committee
 * pages will show a different window and the months will shift with it.
 *
 * NOTHING HERE JUDGES SUBSTANCE. A mention can be a decision about the town
 * or a place name in a list of settlements, and only reading the paper
 * tells them apart. The page points; it never characterises.
 */

const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', '..', 'data');
const CALENDAR = path.join(DIR, 'meetings.json');
const SEARCH = path.join(DIR, 'largs-agenda.json');

const PRIMACY = ['AgendaPack', 'Agenda', 'Report', 'AgendaContents', 'Minute'];
const RECENT_DAYS = 90;

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    return null;
  }
}

function iso(d) {
  return d.toISOString().slice(0, 10);
}

function display(isoDate) {
  const [y, m, d] = isoDate.split('-');
  return `${d}-${m}-${y}`;
}

function monthLabel(isoDate) {
  const [y, m] = isoDate.split('-');
  return `${MONTH_NAMES[parseInt(m, 10) - 1]} ${y}`;
}

module.exports = function () {
  const calendar = readJson(CALENDAR);
  const search = readJson(SEARCH);

  if (!calendar && !search) {
    return { ok: false, upcoming: [], scheduled: [], scheduledByMonth: [],
             recent: [], earlier: [] };
  }

  const rows = new Map();
  const key = (c, d) => `${c}|${d}`;

  for (const m of (calendar && calendar.meetings) || []) {
    if (!m.date || !m.committee) continue;
    rows.set(key(m.committee, m.date), {
      committee: m.committee,
      date: m.date,
      url: m.url || null,
      // null when the meeting page was never read; 0 when it was read and
      // had no documents. The difference is the whole point.
      papers: (m.documents === null || m.documents === undefined)
        ? null : m.documents.length,
      hits: null,
      docType: null,
    });
  }

  const bySearch = new Map();
  for (const it of (search && search.items) || []) {
    if (!it.date || !it.committee) continue;
    const k = key(it.committee, it.date);
    if (!bySearch.has(k)) bySearch.set(k, []);
    bySearch.get(k).push(it);
  }

  for (const [k, docs] of bySearch) {
    const rank = (d) => {
      const i = PRIMACY.indexOf(d.type);
      return i === -1 ? PRIMACY.length : i;
    };
    const best = [...docs].sort((a, b) => rank(a) - rank(b) || b.hits - a.hits)[0];
    const existing = rows.get(k);
    if (existing) {
      existing.hits = best.hits;
      existing.docType = best.type;
      if (existing.papers === null) existing.papers = docs.length;
      if (!existing.url) existing.url = best.meeting_url || null;
    } else {
      const [committee, date] = k.split('|');
      rows.set(k, {
        committee,
        date,
        url: best.meeting_url || null,
        papers: docs.length,
        hits: best.hits,
        docType: best.type,
      });
    }
  }

  const today = new Date();
  const todayIso = iso(today);
  const recentFloor = iso(new Date(today.getTime() - RECENT_DAYS * 86400000));

  const all = [...rows.values()].map((r) => ({
    ...r,
    display: display(r.date),
    state: r.hits ? 'mentioned' : (r.papers ? 'nothing' : 'awaited'),
  }));

  all.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

  const upcoming = all
    .filter((r) => r.date >= todayIso && r.state === 'mentioned')
    .sort((a, b) => (a.date < b.date ? -1 : 1));

  // Everything ahead without a known mention, soonest first. No horizon is
  // imposed: the council's own window is the horizon.
  const scheduled = all
    .filter((r) => r.date >= todayIso && r.state !== 'mentioned')
    .sort((a, b) => (a.date < b.date ? -1 : 1));

  const scheduledByMonth = [];
  for (const m of scheduled) {
    const label = monthLabel(m.date);
    let group = scheduledByMonth[scheduledByMonth.length - 1];
    if (!group || group.label !== label) {
      group = { label, meetings: [] };
      scheduledByMonth.push(group);
    }
    group.meetings.push(m);
  }

  const recent = all.filter((r) => r.date < todayIso && r.date >= recentFloor
                                   && r.state === 'mentioned');
  const earlier = all.filter((r) => r.date < recentFloor && r.state === 'mentioned');

  return {
    ok: true,
    collectedCalendar: (calendar && calendar.collected) || null,
    collectedSearch: (search && search.collected) || null,
    cutoff: (search && search.cutoff) || null,
    recentDays: RECENT_DAYS,
    // The furthest date the council has currently published, so the page
    // can say how far ahead it can see rather than implying it sees all.
    scheduledTo: scheduled.length ? scheduled[scheduled.length - 1].date : null,
    counts: {
      meetings: all.length,
      mentioned: all.filter((r) => r.state === 'mentioned').length,
      upcoming: upcoming.length,
      scheduled: scheduled.length,
      recent: recent.length,
      earlier: earlier.length,
    },
    upcoming,
    scheduled,
    scheduledByMonth,
    recent,
    earlier,
  };
};
