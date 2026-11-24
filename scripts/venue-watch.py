#!/usr/bin/env python3
"""Venue watch: has a venue called off, moved or added a show?

Reads src/_data/events.json and the venue's own website, once a night, and
looks for four things:

  1. a page for a show we list saying it is cancelled, postponed or
     rescheduled;
  2. such a page having gone, which usually means the show was withdrawn;
  3. none of our dates for the show appearing on its page any more;
  4. a NEW SHOW: a page in the venue's sitemap that we neither list nor
     have said to ignore.

IT CHANGES NOTHING. It never edits events.json and never publishes. It
prints what it found and exits non-zero, which turns the run red and makes
GitHub email the owner. A person then reads the venue's page and decides.
Each alarm repeats nightly until it is dealt with, then stops by itself:
  - cancelled show   -> mark the event `cancelled: true`
  - new show         -> add it to events.json with the venue's page as its
                        url; or, if we link it somewhere else (a ticket
                        seller), add the page to "also" in
                        data/venue-watch.json; or, if we are not listing
                        it, add the page to "ignore" there.

data/venue-watch.json
  "also":   { "<venue page url>": "<exact title of our event>" }
            for shows whose "More info" link goes to a ticket seller. The
            venue's own page is then watched for those events too.
  "ignore": [ "<venue page url>", ... ]  pages we have seen and are not
            listing.

WHAT IT DOES NOT SEE. Times are not compared: Barrfields' pages, read by a
program rather than a browser, show times an hour late, so a comparison
would cry wolf on every show. TicketSource is not read at all: its pages
refuse programs (tried 24 Nov 2026), and that is respected, not worked
around.

MANNERS. One request per page, a pause between requests, once a night, with
a User-Agent that says who we are. Barrfields' robots.txt allows all pages
and points to the sitemap (checked 24 Nov 2026).

Run by hand:  python3 scripts/venue-watch.py
"""
import datetime
import html
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from urllib.parse import unquote, urlparse

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EVENTS = os.path.join(ROOT, 'src', '_data', 'events.json')
WATCH = os.path.join(ROOT, 'data', 'venue-watch.json')

# The venue whose own event pages we read.
WATCHED_HOSTS = {'www.barrfieldstheatre.com', 'barrfieldstheatre.com'}
SITEMAP = 'https://www.barrfieldstheatre.com/sitemap.xml'
EVENT_PATH = '/events-3/'            # where the venue keeps its show pages
SITE_SUFFIX = ' | Barrfields Theatre'

UA = {'User-Agent': 'largs.scot board (+https://largs.scot; hello@largs.scot)'}
PAUSE = 2.0
TIMEOUT = 40

# Words that mean "a person should look at this page".
ALARM = re.compile(r'\b(cancel\w*|postpon\w*|reschedul\w*|no longer taking place|called off)', re.I)

MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
          'August', 'September', 'October', 'November', 'December']
DATE_RE = re.compile(r'\b(\d{1,2}) (' + '|'.join(MONTHS) + r') (\d{4})\b')

_last_request = [0.0]


def norm(url):
    """One spelling per page: the sitemap and events.json escape differently."""
    u = unquote(url).strip().lower().replace('’', "'").replace('‘', "'")
    u = re.sub(r'^https?://(www\.)?', '', u)
    return u.rstrip('/')


def page_text(raw):
    """The words a visitor would read: scripts and styles removed, tags dropped."""
    raw = re.sub(r'(?is)<(script|style|noscript)\b.*?</\1>', ' ', raw)
    raw = re.sub(r'(?s)<!--.*?-->', ' ', raw)
    raw = re.sub(r'(?s)<[^>]+>', ' ', raw)
    return re.sub(r'\s+', ' ', html.unescape(raw)).strip()


def page_title(raw):
    m = re.search(r'(?is)<title[^>]*>(.*?)</title>', raw)
    t = re.sub(r'\s+', ' ', html.unescape(m.group(1))).strip() if m else ''
    return t[:-len(SITE_SUFFIX)] if t.endswith(SITE_SUFFIX) else t


def is_gone(status, raw):
    """This site answers 200 for a missing page, with a '404' title."""
    if status in (404, 410):
        return True
    return status == 200 and page_title(raw).startswith('404')


def fetch(url):
    """Returns (status, body). status is an HTTP code, or 0 if unreachable."""
    last = 0
    for attempt in (1, 2):
        wait = PAUSE - (time.time() - _last_request[0])
        if wait > 0:
            time.sleep(wait)
        _last_request[0] = time.time()
        try:
            with urllib.request.urlopen(
                urllib.request.Request(url, headers=UA), timeout=TIMEOUT
            ) as r:
                return r.status, r.read().decode('utf-8', 'replace')
        except urllib.error.HTTPError as e:
            if e.code in (404, 410):
                return e.code, ''
            last = e.code
        except Exception:
            last = 0
        if attempt == 1:
            time.sleep(PAUSE * 2)
    return last, ''


def long_date(iso):
    d = datetime.date.fromisoformat(iso)
    return f'{d.day} {MONTHS[d.month - 1]} {d.year}'


def dates_on(text):
    out = []
    for d, m, y in DATE_RE.findall(text):
        try:
            out.append(datetime.date(int(y), MONTHS.index(m) + 1, int(d)).isoformat())
        except ValueError:
            pass
    return out


def sitemap_pages():
    """Every show page the venue's sitemap lists, or None if unreadable."""
    status, raw = fetch(SITEMAP)
    if status != 200:
        return None
    locs = [html.unescape(x).strip() for x in re.findall(r'(?is)<loc>(.*?)</loc>', raw)]
    pages = [u for u in locs if EVENT_PATH in u]
    for child in [u for u in locs if u.endswith('.xml') and 'events' in u.lower()]:
        status, raw = fetch(child)
        if status != 200:
            return None
        pages += [html.unescape(x).strip() for x in re.findall(r'(?is)<loc>(.*?)</loc>', raw)
                  if EVENT_PATH in x]
    seen, out = set(), []
    for u in pages:
        if norm(u) not in seen and not norm(u).endswith(EVENT_PATH.strip('/')):
            seen.add(norm(u))
            out.append(u)
    return out


def main():
    today = datetime.date.today().isoformat()
    items = json.load(open(EVENTS, encoding='utf-8'))['items']
    watch = json.load(open(WATCH, encoding='utf-8')) if os.path.isfile(WATCH) else {}
    also = watch.get('also') or {}
    ignore = {norm(u) for u in (watch.get('ignore') or [])}

    attention, notes, unreachable = [], [], []

    # Venue page -> the events of ours it describes.
    pages = {}
    for e in items:
        url = e.get('url') or ''
        if urlparse(url).hostname in WATCHED_HOSTS:
            pages.setdefault(norm(url), {'url': url, 'evs': []})['evs'].append(e)
    for url, title in also.items():
        evs = [e for e in items if e.get('title') == title]
        if not evs:
            notes.append(f'data/venue-watch.json "also" names "{title}", and no event has that exact title.\n    {url}')
        pages.setdefault(norm(url), {'url': url, 'evs': []})['evs'] += evs

    known = set(pages) | ignore

    def upcoming(e):
        return (e.get('until') or e.get('date') or '') >= today

    to_check = [p for p in pages.values() if any(upcoming(e) for e in p['evs'])]
    to_check.sort(key=lambda p: min(e['date'] for e in p['evs'] if upcoming(e)))
    checked = 0

    for p in to_check:
        url = p['url']
        evs = [e for e in p['evs'] if upcoming(e)]
        live = [e for e in evs if not e.get('cancelled')]
        title = evs[0]['title']
        status, raw = fetch(url)
        if is_gone(status, raw):
            if live:
                attention.append(f'PAGE GONE: "{title}" on {live[0]["date"]} — the venue\'s page for it no longer exists.\n    {url}')
            continue
        if status != 200:
            unreachable.append(f'"{title}": {"no answer" if status == 0 else "HTTP " + str(status)}\n    {url}')
            continue
        checked += 1
        text = page_text(raw)
        m = ALARM.search(text)
        if m and live:
            a, b = max(0, m.start() - 70), min(len(text), m.end() + 70)
            when = live[0]['date'] if len(live) == 1 else f'{len(live)} performances from {live[0]["date"]}'
            attention.append(f'VENUE SAYS "{m.group(0).upper()}": "{title}" ({when})\n    page reads: …{text[a:b]}…\n    {url}')
        elif live and not any(long_date(e['date']) in text for e in live):
            ours = ', '.join(long_date(e['date']) for e in live[:4])
            theirs = ', '.join(long_date(d) for d in sorted(set(dates_on(text)))[:4]) or 'no date found'
            attention.append(f'DATE NOT ON PAGE: "{title}" — we say {ours}; the venue\'s page shows {theirs}.\n    {url}')
        elif not live and not m:
            notes.append(f'We list "{title}" as cancelled, but the venue\'s page no longer says so.\n    {url}')

    # New shows: pages in the venue's sitemap that we do not know about.
    listed = sitemap_pages()
    if listed is None:
        unreachable.append(f'the venue\'s sitemap, so new shows were not looked for tonight\n    {SITEMAP}')
    else:
        for url in listed:
            if norm(url) in known:
                continue
            status, raw = fetch(url)
            if is_gone(status, raw):
                continue
            if status != 200:
                unreachable.append(f'a page we do not list: {"no answer" if status == 0 else "HTTP " + str(status)}\n    {url}')
                continue
            found = sorted(set(dates_on(page_text(raw))))
            name = page_title(raw) or '(no title)'
            if found and max(found) < today:
                notes.append(f'An old page we never listed is still on the venue\'s site: "{name}", {long_date(max(found))}. Add it to "ignore" in data/venue-watch.json to silence this.\n    {url}')
                continue
            when = ', '.join(long_date(d) for d in found[:4]) or 'no date found on the page'
            attention.append(f'NEW SHOW: "{name}" — {when}. Not on What\'s on.\n    {url}')

    out = [f'Venue watch, {today}: {checked} of {len(to_check)} show pages read'
           + ('' if listed is None else f'; the venue\'s sitemap lists {len(listed)}') + '.']
    if attention:
        out += ['', 'NEEDS A LOOK:'] + ['  ' + a for a in attention]
    if notes:
        out += ['', 'Notes:'] + ['  ' + x for x in notes]
    if unreachable:
        out += ['', 'Could not be read tonight:'] + ['  ' + x for x in unreachable]
    if not (attention or notes or unreachable):
        out.append('Nothing cancelled, moved, missing or new.')
    report = '\n'.join(out)
    print(report)

    summary = os.environ.get('GITHUB_STEP_SUMMARY')
    if summary:
        with open(summary, 'a', encoding='utf-8') as f:
            f.write('```\n' + report + '\n```\n')

    if attention:
        sys.exit(1)
    # One page failing is weather; every page failing means we are blind.
    if to_check and checked == 0:
        print('\nNo page could be read at all, so nothing was checked.')
        sys.exit(2)


if __name__ == '__main__':
    main()
