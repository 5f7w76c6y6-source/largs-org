/* On the council's agenda — build-time shaping, from three sources.
 *
 *   data/meetings.json      every scheduled meeting, from the council's own
 *                           committee pages. Knows about meetings months
 *                           ahead whose papers do not exist yet.
 *   data/largs-agenda.json  which meetings have papers mentioning Largs,
 *                           from the council's document search.
 *   data/largs-papers.json  the agenda packs this site has read itself
 *                           (scripts/agenda/papers.py), with its own count.
 *                           Added 24 Sep 2026 because the council's search
 *                           indexes new papers a fortnight or more after
 *                           they are published — too late for "coming up".
 *                           The count is the same measure the search uses
 *                           (occurrences of the word), verified on two
 *                           packs, and where both exist ours is used.
 *
 * WHY BOTH. The search can only see documents, so it cannot know a meeting
 * is happening until its papers are lodged — three days beforehand. The
 * calendar knows the date months out but nothing about content. Merging
 * them lets a row say which of three things is true, where a single source
 * would have made all three look alike:
 *
 *   mentioned   papers are published and Largs appears in them
 *   none        papers are published, this site has read them, no Largs
 *   nothing     papers are published, unread here, and the council's
 *               search has not found Largs in them — which, given the
 *               lag, is not the same as "no mention"
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
const PAPERS = path.join(DIR, 'largs-papers.json');

const PRIMACY = ['AgendaPack', 'Agenda', 'Report', 'AgendaContents', 'Minute'];
const RECENT_DAYS = 90;
// Papers appear about three days before a meeting, so a page that has not
// read the council's website in the last two days cannot honestly say what
// is coming up. Past this the page says when it last looked, and presents
// what it holds as a snapshot from that day rather than the current state.
const STALE_DAYS = 2;

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
  const papers = readJson(PAPERS);

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
      existing.searchHits = best.hits;
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
        searchHits: best.hits,
        docType: best.type,
      });
    }
  }

  // Packs this site has read. One number per meeting: the packs summed
  // (main plus any supplementary), or, where no pack existed and loose
  // documents were read, the largest count, since those overlap. Two
  // meetings on one date under one committee (a Special Council) are
  // separate meetings, so their numbers add.
  const byRead = new Map();
  for (const r of (papers && papers.records) || []) {
    if (r.status !== 'ok' || !r.date || !r.committee) continue;
    const k = key(r.committee, r.date);
    if (!byRead.has(k)) byRead.set(k, new Map());
    const perMeeting = byRead.get(k);
    const mid = String(r.meetingId || r.meetingUrl || '');
    const cur = perMeeting.get(mid) || { hits: 0, pack: false, docs: 0, read: null, url: null };
    if (r.pack) {
      cur.hits = (cur.pack ? cur.hits : 0) + (r.hits || 0);
      cur.pack = true;
    } else if (!cur.pack) {
      cur.hits = Math.max(cur.hits, r.hits || 0);
    }
    cur.docs += 1;
    if (!cur.read || r.read > cur.read) cur.read = r.read;
    cur.url = cur.url || r.meetingUrl || null;
    perMeeting.set(mid, cur);
  }
  for (const [k, perMeeting] of byRead) {
    const parts = [...perMeeting.values()];
    const hits = parts.reduce((s, p) => s + p.hits, 0);
    const readAt = parts.map((p) => p.read).sort().pop() || null;
    const existing = rows.get(k);
    if (existing) {
      existing.hits = hits;
      existing.read = true;
      existing.readAt = readAt;
      existing.docType = parts.some((p) => p.pack) ? 'AgendaPack' : (existing.docType || 'Report');
      if (existing.papers === null) existing.papers = parts.reduce((s, p) => s + p.docs, 0);
      if (!existing.url) existing.url = parts[0].url;
    } else {
      const [committee, date] = k.split('|');
      rows.set(k, {
        committee,
        date,
        url: parts[0].url,
        papers: parts.reduce((s, p) => s + p.docs, 0),
        hits,
        docType: parts.some((p) => p.pack) ? 'AgendaPack' : 'Report',
        read: true,
        readAt,
      });
    }
  }

  const today = new Date();
  const todayIso = iso(today);
  const recentFloor = iso(new Date(today.getTime() - RECENT_DAYS * 86400000));

  const all = [...rows.values()].map((r) => ({
    ...r,
    display: display(r.date),
    state: r.hits ? 'mentioned'
      : r.read ? 'none'
        : (r.papers ? 'nothing' : 'awaited'),
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
  // Past meetings whose papers are out, later than anything the council's
  // search has found Largs in. Their absence from "Recently" would read as
  // "no mention"; more likely the index has not reached them (see papersOut).
  // "Newest the search has found" is about the search's reach, so packs
  // this site read itself do not move it.
  const newestFound = all.filter((r) => r.searchHits)
    .map((r) => r.date).sort().pop() || null;
  const readNone = all
    .filter((r) => r.date < todayIso && r.date >= recentFloor && r.state === 'none')
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  const notYetSearched = all
    .filter((r) => r.date < todayIso && r.date >= recentFloor && r.state === 'nothing'
                   && newestFound && r.date > newestFound)
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  const earlier = all.filter((r) => r.date < recentFloor && r.state === 'mentioned');

  // When the council's website was last read. Each collector stamps its own
  // run; the OLDER of the two bounds every claim the page makes. A stamp
  // without a zone is the collector's local clock -- an hour either way,
  // which does not matter when the unit is days.
  const stamps = [calendar && calendar.collected, search && search.collected]
    .map((s) => Date.parse(s || '')).filter(Number.isFinite);
  const collectedMs = stamps.length ? Math.min(...stamps) : null;
  const ageDays = collectedMs === null ? null
    : Math.floor((today.getTime() - collectedMs) / 86400000);

  return {
    ok: true,
    collectedCalendar: (calendar && calendar.collected) || null,
    collectedSearch: (search && search.collected) || null,
    collectedPapers: (papers && papers.collected) || null,
    cutoff: (search && search.cutoff) || null,
    recentDays: RECENT_DAYS,
    // The page's honesty line: when the council's site was last read, and
    // whether that is recent enough to describe the present tense.
    collectedAt: collectedMs === null ? null : new Date(collectedMs).toISOString(),
    ageDays,
    stale: collectedMs === null || ageDays > STALE_DAYS,
    staleDays: STALE_DAYS,
    // The furthest date the council has currently published, so the page
    // can say how far ahead it can see rather than implying it sees all.
    scheduledTo: scheduled.length ? scheduled[scheduled.length - 1].date : null,
    counts: {
      meetings: all.length,
      mentioned: all.filter((r) => r.state === 'mentioned').length,
      upcoming: upcoming.length,
      scheduled: scheduled.length,
      // Ahead, papers out, nothing found. Not "no mention": the council's
      // full-text index can run a fortnight behind publication (24 Sep 2026:
      // a search for a word in a 16 Sep report title found nothing from that
      // meeting), so the page says "found" and "yet", never "none".
      papersOut: scheduled.filter((r) => r.state === 'nothing').length,
      // Ahead, papers read by this site, no Largs: a real "no mention".
      papersRead: scheduled.filter((r) => r.state === 'none').length,
      recent: recent.length,
      earlier: earlier.length,
    },
    upcoming,
    scheduled,
    scheduledByMonth,
    recent,
    readNone,
    notYetSearched,
    earlier,
  };
};
