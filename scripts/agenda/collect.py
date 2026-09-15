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
# introduce itself as a Mac running Safari.
"""
Collect every North Ayrshire committee document mentioning Largs, from
CMIS's own full-text search, back to a cutoff date.

    python3 scripts/agenda/collect.py              # back to 1 January 2025
    python3 scripts/agenda/collect.py 2026-01-01   # back to another date

Standard library only. Writes largs-agenda.json in the working directory.

Why it works this way
---------------------
CMIS search is an ASP.NET postback, not a GET: there is no URL that
carries the search term. Each request must echo back the __VIEWSTATE and
__EVENTVALIDATION tokens from the page it came from, so pages are fetched
in sequence and the tokens re-scraped every time. The form is declared
multipart/form-data, so a urlencoded POST is refused.

Two values are fussy and were found the hard way: the mode radio is
"Simple" (not "rboSimple") and the selector is lowercase "documents".
ASP.NET validates posted values against what it rendered, and a mismatch
redirects to Default.aspx with an error rather than failing loudly, which
is why post() checks the final URL.

Pagination is a GridView: target the grid itself, argument "Page$N". The
pager shows a rolling window of ten page numbers, so walking one page at
a time is the only reliable route.
"""

import http.cookiejar
import html as ht
import json
import re
import os
import sys
import time
import urllib.request
from datetime import datetime, timezone

URL = 'https://north-ayrshire.cmis.uk.com/north-ayrshire/Search.aspx'
UA = {'User-Agent': 'largs.scot agenda watch (+https://largs.scot/on-the-agenda/; hello@largs.scot)'}
P = 'dnn$ctr793$ViewCMIS_Search$'          # DNN module id — moves if the page is rebuilt
GRID = P + 'grdDocuments'
TERM = 'largs'
PAUSE = 2                                   # seconds between requests, be polite
MAX_PAGES = 40
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'data', 'largs-agenda.json')

MONTHS = dict(Jan=1, Feb=2, Mar=3, Apr=4, May=5, Jun=6,
              Jul=7, Aug=8, Sep=9, Oct=10, Nov=11, Dec=12)

jar = http.cookiejar.CookieJar()
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))


def hidden(page, name):
    """Value of a hidden input, whichever order the attributes appear in."""
    m = (re.search(r'name="%s"[^>]*value="([^"]*)"' % re.escape(name), page)
         or re.search(r'value="([^"]*)"[^>]*name="%s"' % re.escape(name), page))
    return m.group(1) if m else None


def tokens(page):
    return {
        '__VIEWSTATE': hidden(page, '__VIEWSTATE'),
        '__VIEWSTATEGENERATOR': hidden(page, '__VIEWSTATEGENERATOR'),
        '__VIEWSTATEENCRYPTED': hidden(page, '__VIEWSTATEENCRYPTED') or '',
        '__EVENTVALIDATION': hidden(page, '__EVENTVALIDATION'),
        '__dnnVariable': hidden(page, '__dnnVariable') or '',
    }


def post(fields):
    boundary = '----ffffcmis' + str(int(time.time() * 1000))
    parts = [f'--{boundary}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n'
             for k, v in fields.items()]
    parts.append(f'--{boundary}--\r\n')
    req = urllib.request.Request(
        URL, data=''.join(parts).encode('utf-8'),
        headers={**UA, 'Content-Type': f'multipart/form-data; boundary={boundary}',
                 'Referer': URL})
    r = opener.open(req, timeout=180)
    body = r.read().decode('utf-8', 'replace')
    if 'error=' in r.url:
        raise SystemExit('STOP: the server rejected the post.\n  %s\n'
                         '  Usually means a posted value no longer matches what the '
                         'form rendered.' % r.url[:140])
    return body


def cell_text(cell):
    return ' '.join(re.sub(r'<[^>]+>', ' ', ht.unescape(cell)).split())


def first_href(cell):
    m = re.search(r'href="([^"]+)"', cell)
    if not m:
        return None
    href = ht.unescape(m.group(1))
    if href.startswith('/'):
        href = 'https://north-ayrshire.cmis.uk.com' + href
    return href


def parse(page, today):
    """Rows whose last cell reads 'Meeting: <committee> - DD/Mon/YYYY'."""
    rows = []
    for row in re.findall(r'<tr[^>]*>(.*?)</tr>', page, re.S):
        cells = re.findall(r'<td[^>]*>(.*?)</td>', row, re.S)
        if len(cells) < 5:
            continue
        m = re.search(r'^Meeting:\s*(.+?)\s*-\s*(\d{1,2})/(\w{3})/(\d{4})$',
                      cell_text(cells[-1]))
        if not m:
            continue
        d = datetime(int(m.group(4)), MONTHS[m.group(3)], int(m.group(2))).date()
        rows.append({
            'hits': int(cell_text(cells[1]) or 0),
            'title': cell_text(cells[2]),
            'doc_url': first_href(cells[2]),
            'type': cell_text(cells[3]),
            'size': cell_text(cells[4]),
            'committee': m.group(1),
            'date': d.isoformat(),
            'days': (d - today).days,
            'meeting_url': first_href(cells[-1]),
        })
    return rows


def main():
    cutoff = datetime.fromisoformat(sys.argv[1]).date() if len(sys.argv) > 1 \
        else datetime(2025, 1, 1).date()
    today = datetime.now(timezone.utc).date()
    print(f'collecting "{TERM}" back to {cutoff}\n')

    page = opener.open(urllib.request.Request(URL, headers=UA), timeout=60) \
        .read().decode('utf-8', 'replace')
    if P + 'SimpleSearchFor' not in page:
        raise SystemExit('STOP: %sSimpleSearchFor is not on the page — the DNN module '
                         'id has changed. Re-read the form field names.' % P)

    base = {'__EVENTTARGET': '', '__EVENTARGUMENT': '', '__LASTFOCUS': '',
            'ScrollTop': '', **tokens(page),
            P + 'rboModeSwitch': 'Simple',
            P + 'SimpleSearchSelector': 'documents',
            P + 'SimpleSearchFor': TERM,
            P + 'SimpleSearchSubmit': 'Start Search'}

    res = post(base)
    total = re.search(r'Search Results\s*\((\d+)', res, re.I)
    print('search reports', total.group(1) if total else '?', 'documents in total\n')

    items, seen, n = [], set(), 1
    while True:
        got = parse(res, today)
        new = [i for i in got if (i['doc_url'] or i['title'] + i['date']) not in seen]
        for i in new:
            seen.add(i['doc_url'] or i['title'] + i['date'])
        items += new
        oldest = min((i['date'] for i in got), default=None)
        print(f'  page {n:>2}: {len(got):>2} rows, {len(new):>2} new, oldest {oldest}')

        if not got:
            print('  (no rows — stopping)')
            break
        if not new:
            print('  (every row already seen — the pager did not advance, stopping)')
            break
        if oldest and datetime.fromisoformat(oldest).date() < cutoff:
            break
        if n >= MAX_PAGES:
            print('  (hit MAX_PAGES)')
            break
        if f'Page${n + 1}' not in res:
            print(f'  (no link to page {n + 1} — stopping)')
            break

        time.sleep(PAUSE)
        step = {**base, **tokens(res),
                '__EVENTTARGET': GRID, '__EVENTARGUMENT': f'Page${n + 1}'}
        step.pop(P + 'SimpleSearchSubmit', None)   # a pager click is not a submit
        res = post(step)
        n += 1

    items = [i for i in items if datetime.fromisoformat(i['date']).date() >= cutoff]
    items.sort(key=lambda i: (i['date'], i['committee']), reverse=True)
    json.dump({'collected': datetime.now(timezone.utc).isoformat(timespec='seconds'),
               'term': TERM, 'cutoff': cutoff.isoformat(), 'items': items},
              open(OUT, 'w'), indent=1)

    from collections import Counter
    meetings = {(i['committee'], i['date']) for i in items}
    print(f'\n{len(items)} documents across {len(meetings)} meetings, '
          f'{items[-1]["date"]} to {items[0]["date"]}')
    print(f'written to {OUT}\n')

    print('by committee:')
    for k, v in Counter(i['committee'] for i in items).most_common():
        print(f'  {v:>3}  {k}')
    print('\nby type:')
    for k, v in Counter(i['type'] for i in items).most_common():
        print(f'  {v:>3}  {k}')

    ahead = [i for i in items if i['days'] >= -7]
    print(f'\nwithin the last week or still ahead: {len(ahead)}')
    for i in ahead:
        print(f'  {i["date"]}  {i["days"]:>4}d  {i["hits"]:>3} hits  '
              f'{i["type"]:<15} {i["committee"]}')


if __name__ == '__main__':
    main()
