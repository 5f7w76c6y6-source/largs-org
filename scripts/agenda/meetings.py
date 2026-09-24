#!/usr/bin/env python3
# LIVES IN THE REPO so that .github/workflows/agenda-watch.yml can run it
# nightly on GitHub's runners and commit the result to data/. The working
# folder ~/Developer/agenda-watch, where this was written and first run on
# 16 August 2026, keeps the original alongside the private reading tools
# (snippets.py, reconcile.py, terms.py, counts.py), which do not run here.
#
# Two things differ from that copy. OUT is anchored to the repo's data/
# folder rather than the current directory, so the workflow and a run from
# any shell write the same file. And the User-Agent says who we are and how
# to reach us, as the buses fetch does -- a scheduled visitor should not
# introduce itself as a Mac running Safari. (The council's site accepted the
# honest name first time, 15 September 2026.)
"""
Enumerate North Ayrshire's meetings, and the papers lodged for them.

    python3 scripts/agenda/meetings.py             # every committee that can carry Largs business
    python3 scripts/agenda/meetings.py --quick     # skip meeting pages; dates only, 11 requests

Called meetings.py here, not calendar.py as in the working folder: a script
named calendar.py shadows Python's own `calendar` module for anything run
from the same directory, and collect.py's cookie jar imports it -- found the
hard way on 15 September 2026.

Writes meetings.json. Downloads no PDFs — that is snippets.py's job.

WHY NOT USE THE COUNCIL'S SEARCH. It was the obvious route and it is not
trustworthy for this. Searching "largs" returns 469 documents and
reconciles exactly against what we extract, so it is sound for one
distinctive word. But "North Coast" returns 519, "North Coast and Cumbrae"
returns 536, and plain "North" returns 424 — a more specific phrase cannot
match more documents than a less specific one, and every paper in the
system says "North Ayrshire" on its front page. Common terms all land in a
narrow band around 500, which looks like a result cap or a relevance
cut-off rather than a count. So the search cannot enumerate, and anything
built on it inherits a blind spot of unknown size.

WHAT THIS DOES INSTEAD. Committee pages list their own meetings on plain
GET, no form, no postback. Eleven requests gives every meeting each
committee currently shows — including ones months ahead whose papers do
not exist yet, which the search could never know about. Each meeting page
then lists its documents. Terms and filtering happen locally afterwards,
on text we hold, so a new term next year is a re-grep rather than a
rediscovery.

COMMITTEES OMITTED ON PURPOSE. Appeals (136), Education Appeals (140) and
Staffing and Recruitment (149) hear cases about individual employees and
parents. They are excluded as a matter of principle, not noise.

The Licensing BOARD is not a committee and does not appear in the
committee list at all — it has its own page. It is the busiest source of
Largs material after full Council, and it needs adding separately.
"""

import html as ht
import json
import re
import os
import sys
import time
import urllib.request
from datetime import datetime

COMMITTEE_URL = ('https://north-ayrshire.cmis.uk.com/north-ayrshire/CommitteesMeetings/'
                 'Committees/tabid/62/ctl/ViewCMIS_CommitteeDetails/mid/381/id/{}/Default.aspx')
# The Licensing Board is not a committee and lives under its own tab and
# module. Its own page links to three bodies: id 22 is the 2012-2017 board,
# id 153 is the Local Licensing Forum (advisory, different thing), and
# id 129 is the current statutory Board — the only one that decides.
BOARD_URL = ('https://north-ayrshire.cmis.uk.com/north-ayrshire/CommitteesMeetings/'
             'LicensingBoard/tabid/185/ctl/ViewCMIS_CommitteeDetails/mid/692/id/{}/Default.aspx')
MEETING = ('https://north-ayrshire.cmis.uk.com/north-ayrshire/CommitteesMeetings/'
           'MeetingsCalendar/tabid/70/ctl/ViewMeetingPublic/mid/397/Meeting/{}/'
           'Committee/{}/Default.aspx')
UA = {'User-Agent': 'largs.scot agenda watch (+https://largs.scot/on-the-agenda/; hello@largs.scot)'}
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'data', 'meetings.json')
PAUSE = 2

COMMITTEES = {
    135: 'North Ayrshire Council',
    137: 'Audit and Scrutiny Committee',
    139: 'Cabinet',
    141: 'Integration Joint Board',
    142: 'Licensing Committee',
    143: 'Local Development Plan Committee',
    144: 'Local Review Body',
    145: 'North Ayrshire Council (Planning)',
    146: 'North Ayrshire Council (Planning) (Pre-Determination Hearing)',
    147: 'Planning Committee',
    148: 'Police and Fire and Rescue Committee',
}

# Committee id -> the URL template that serves it.
BOARDS = {129: 'North Ayrshire Licensing Board'}
def page_url(cid):
    return (BOARD_URL if cid in BOARDS else COMMITTEE_URL).format(cid)

# The committee details block carries "Active: 06 May 2022 - onwards", which
# is the start of the administration, not a meeting. Never treat it as one.
ADMIN_START = '2022-05-06'

MONTHS = {m: i for i, m in enumerate(
    ['January', 'February', 'March', 'April', 'May', 'June', 'July',
     'August', 'September', 'October', 'November', 'December'], 1)}


def get(url, timeout=90):
    return urllib.request.urlopen(
        urllib.request.Request(url, headers=UA), timeout=timeout
    ).read().decode('utf-8', 'replace')


def to_iso(s):
    m = re.match(r'(\d{1,2})\s+(\w+)\s+(20\d\d)', s.strip())
    if not m or m.group(2) not in MONTHS:
        return None
    return f'{m.group(3)}-{MONTHS[m.group(2)]:02d}-{int(m.group(1)):02d}'


def meetings_on(page, cid):
    """Meeting id and date, read from the row each link sits in."""
    found = {}
    for row in re.findall(r'<tr[^>]*>(.*?)</tr>', page, re.S):
        m = re.search(r'Meeting/(\d+)/Committee/%d' % cid, row)
        if not m:
            continue
        text = ' '.join(re.sub(r'<[^>]+>', ' ', ht.unescape(row)).split())
        d = re.search(r'(\d{1,2}\s+\w+\s+20\d\d)', text)
        iso = to_iso(d.group(1)) if d else None
        if iso == ADMIN_START:
            iso = None
        status = 'occurred' if re.search(r'\bOccurred\b', text, re.I) else (
            'scheduled' if re.search(r'\bScheduled\b', text, re.I) else '')
        found[m.group(1)] = {'id': m.group(1), 'date': iso, 'status': status}
    return list(found.values())


def documents_on(page):
    """Documents lodged for a meeting, from its own page."""
    docs = []
    for m in re.finditer(r'<a[^>]+href="([^"]*Document\.ashx[^"]*)"[^>]*>(.*?)</a>',
                         page, re.S):
        href = ht.unescape(m.group(1))
        if href.startswith('/'):
            href = 'https://north-ayrshire.cmis.uk.com' + href
        title = ' '.join(re.sub(r'<[^>]+>', ' ', ht.unescape(m.group(2))).split())
        if title:
            docs.append({'title': title, 'url': href})
    return docs


def main():
    quick = '--quick' in sys.argv
    today = datetime.now().date().isoformat()
    out = []
    failed = []          # any fetch that failed: then nothing is written

    for cid, name in {**COMMITTEES, **BOARDS}.items():
        try:
            page = get(page_url(cid))
        except Exception as exc:
            print(f'{name:<50} FAILED {exc}')
            failed.append(name)
            continue
        rows = [r for r in meetings_on(page, cid) if r['date']]
        rows.sort(key=lambda r: r['date'])
        ahead = sum(1 for r in rows if r['date'] >= today)
        print(f'{name:<50} {len(rows):>3} meetings, {ahead} still ahead')
        for r in rows:
            out.append({'committee': name, 'committeeId': cid, **r,
                        'url': MEETING.format(r['id'], cid),
                        'ahead': r['date'] >= today, 'documents': None})
        time.sleep(PAUSE)

    if not quick:
        print(f'\nreading {len(out)} meeting pages for documents…')
        for i, m in enumerate(out, 1):
            try:
                page = get(m['url'])
                m['documents'] = documents_on(page)
            except Exception as exc:
                print(f'  [{i}/{len(out)}] {m["date"]} {m["committee"]}: {exc}')
                failed.append(f'{m["date"]} {m["committee"]}')
                continue
            n = len(m['documents'])
            if n or m['ahead']:
                print(f'  [{i}/{len(out)}] {m["date"]}  {m["committee"][:40]:<42}'
                      f'{n} document(s)' + ('  ← ahead' if m['ahead'] else ''))
            time.sleep(PAUSE)

    if failed:
        # A partial file would be committed and shown as fresh. Leave the
        # last good one in place instead; the page flags itself stale on its
        # own after STALE_DAYS. (24 September 2026: a run with no route to the
        # council's site wrote an empty file before this guard existed.)
        print(f'\nSTOP: {len(failed)} fetch(es) failed; {OUT} left as it was:')
        for f in failed:
            print('  ' + f)
        raise SystemExit(1)

    out.sort(key=lambda m: m['date'])
    json.dump({'collected': datetime.now().isoformat(timespec='seconds'),
               'committees': COMMITTEES, 'meetings': out}, open(OUT, 'w'), indent=1)

    ahead = [m for m in out if m['ahead']]
    print(f'\n{len(out)} meetings, {len(ahead)} still ahead. Written to {OUT}\n')
    if ahead:
        print('COMING UP')
        for m in sorted(ahead, key=lambda m: m['date']):
            docs = m['documents']
            state = ('papers not published yet' if docs is not None and not docs
                     else f'{len(docs)} document(s)' if docs else '—')
            print(f'  {m["date"]}  {m["committee"][:44]:<46}{state}')




if __name__ == '__main__':
    main()
