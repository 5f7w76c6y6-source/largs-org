#!/usr/bin/env python3
# LIVES IN THE REPO beside meetings.py and collect.py, for the same reason:
# so .github/workflows/agenda-watch.yml can run it nightly and commit the
# result to data/. Same honest User-Agent as the other two.
"""
Read the council's own agenda packs and count the mentions of Largs ourselves.

    pip3 install pypdf                             # once; add --break-system-packages if it refuses
    python3 scripts/agenda/papers.py               # read what is new, two seconds between downloads
    python3 scripts/agenda/papers.py --dry-run     # list what would be read; fetch nothing
    python3 scripts/agenda/papers.py --pdf x.pdf   # count one local file, as a check

Reads   data/meetings.json      from meetings.py: every meeting and its documents
        data/largs-agenda.json  from collect.py: what the council's search has found
Writes  data/largs-papers.json  one record per document read. Never shrinks.

WHY A THIRD COLLECTOR. collect.py asks the council's own document search,
and that search indexes new papers a fortnight or more after they are
published (24 September 2026: a search for a word in the title of a 16
September Council report found nothing from that meeting). A page about
what is coming up cannot wait a fortnight. So for the meetings ahead, and
the recent ones the search has not reached, this fetches the papers
themselves, once each, and counts.

THE SAME NUMBER THE SEARCH GIVES. The search's "hits" for a document is the
number of times the word occurs; counting whole-word, case-insensitive
"largs" in the pack's text reproduced it exactly on the two packs it was
checked against (IJB 20 Aug 2026: 4 and 4; Council 24 Jun 2026: 32 and 32).
So a count from here and a count from the search mean the same thing, and
agenda.cjs can prefer ours without the page changing its units.

ONE PACK PER MEETING. The Agenda Document Pack (the Licensing Board calls
its "Agenda - <date>") holds every report, so where one exists only packs
are fetched: the main one and any Supplementary pack, summed. Where there
is none yet (early on, an "Agenda Contents" alone), every listed document
is read and the largest count taken, since loose documents overlap.

COUNTS ONLY. The pack's text never leaves this process. Packs carry
objection emails and personal names; the reading tool in the working
folder exists for a person to read them, and nothing from it is
published. Here: title, link, pages, bytes, a number.

NEVER RE-READ, NEVER SHRINK. A document read once is done; the record is
the cache, keyed by meeting and title, so a nightly run fetches only what
the council published since last night -- usually nothing, sometimes one
pack. The file is rewritten after every document, so an interrupted run
keeps its progress. A failed fetch is recorded as failed and tried again
next run. Records for meetings that have left the window are kept.
"""

import json
import os
import re
import sys
import tempfile
import time
import urllib.request
from datetime import datetime, timedelta, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.normpath(os.path.join(HERE, '..', '..', 'data'))
MEETINGS = os.path.join(DATA, 'meetings.json')
SEARCH = os.path.join(DATA, 'largs-agenda.json')
OUT = os.path.join(DATA, 'largs-papers.json')

UA = {'User-Agent': 'largs.scot agenda watch (+https://largs.scot/on-the-agenda/; hello@largs.scot)'}
PAUSE = 2                                   # seconds between downloads, be polite
LOOKBACK_DAYS = 60                          # past meetings this far back are candidates
MAX_BYTES = 80 * 1024 * 1024                # refuse anything larger; the biggest pack seen was 23 MB
TERM = re.compile(r'\blargs\b', re.I)
PACK = re.compile(r'^(Supplementary )?Agenda( Document Pack)?\b(?! Contents)', re.I)


def stamp():
    return datetime.now(timezone.utc).isoformat(timespec='seconds')


def is_pack(title):
    return bool(PACK.match(title or ''))


def rec_key(meeting, doc):
    # Two meetings can share a committee, a date and a document title (16
    # Sep 2026: Council and a Special Council, both "Agenda Document Pack -
    # North Ayrshire Council - 16/09/2026"), so the meeting id is in the key.
    return f"{meeting['date']}|{meeting['committee']}|{meeting.get('id', '')}|{doc['title']}"


def load_records():
    try:
        with open(OUT, encoding='utf-8') as f:
            return {r['key']: r for r in json.load(f).get('records', [])}
    except (OSError, ValueError):
        return {}


def save_records(records):
    ordered = sorted(records.values(), key=lambda r: (r['date'], r['committee'], r['title']), reverse=True)
    body = {'collected': stamp(), 'lookbackDays': LOOKBACK_DAYS,
            'method': 'whole-word, case-insensitive "largs" in the text of the '
                      'agenda pack; the same number the council\'s search reports',
            'records': ordered}
    tmp = OUT + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(body, f, indent=1, ensure_ascii=False)
        f.write('\n')
    os.replace(tmp, OUT)


def count_pdf(path):
    """(hits, pages, pages_with_hits). Raises on an unreadable file."""
    from pypdf import PdfReader
    reader = PdfReader(path)
    hits = pages_with = 0
    for page in reader.pages:
        try:
            text = page.extract_text() or ''
        except Exception:
            continue
        n = len(TERM.findall(text))
        hits += n
        pages_with += 1 if n else 0
    return hits, len(reader.pages), pages_with


def fetch(url):
    """Download to a temporary file; returns (path, bytes)."""
    req = urllib.request.Request(url, headers=UA)
    fd, path = tempfile.mkstemp(suffix='.pdf', prefix='largs-paper-')
    size = 0
    try:
        with urllib.request.urlopen(req, timeout=600) as r, os.fdopen(fd, 'wb') as f:
            while True:
                chunk = r.read(1024 * 256)
                if not chunk:
                    break
                size += len(chunk)
                if size > MAX_BYTES:
                    raise ValueError(f'larger than {MAX_BYTES // 1048576} MB, refused')
                f.write(chunk)
    except Exception:
        try:
            os.unlink(path)
        except OSError:
            pass
        raise
    return path, size


def candidates(meetings, search_keys, records, today):
    """Documents to read, oldest meeting first."""
    floor = (today - timedelta(days=LOOKBACK_DAYS)).isoformat()
    today_iso = today.isoformat()
    out = []
    for m in sorted(meetings, key=lambda m: m['date']):
        docs = m.get('documents') or []
        if not docs or m['date'] < floor:
            continue
        past = m['date'] < today_iso
        if past and (m['committee'], m['date']) in search_keys:
            continue                        # the search has reached it; nothing to add
        packs = [d for d in docs if is_pack(d['title'])]
        for d in (packs or docs):
            k = rec_key(m, d)
            r = records.get(k)
            if r and r['status'] == 'ok':
                continue
            out.append((m, d, k, bool(packs)))
    return out


def main():
    argv = sys.argv[1:]
    if '--pdf' in argv:
        path = argv[argv.index('--pdf') + 1]
        hits, pages, pages_with = count_pdf(path)
        print(f'{path}: {hits} mention(s) of Largs on {pages_with} of {pages} pages')
        return
    dry = '--dry-run' in argv

    try:
        from pypdf import PdfReader  # noqa: F401
    except ImportError:
        raise SystemExit('STOP: pypdf is not installed. Run: pip3 install pypdf '
                         '(add --break-system-packages if it refuses)')

    try:
        with open(MEETINGS, encoding='utf-8') as f:
            meetings = json.load(f).get('meetings') or []
    except (OSError, ValueError) as exc:
        raise SystemExit(f'STOP: cannot read {MEETINGS}: {exc}')
    if not meetings:
        raise SystemExit(f'STOP: {MEETINGS} lists no meetings; run meetings.py first')

    search_keys = set()
    try:
        with open(SEARCH, encoding='utf-8') as f:
            for it in json.load(f).get('items', []):
                search_keys.add((it.get('committee'), it.get('date')))
    except (OSError, ValueError):
        pass                                # the search file is optional here

    records = load_records()
    today = datetime.now().date()
    todo = candidates(meetings, search_keys, records, today)

    print(f'{len(records)} document(s) already read; {len(todo)} to read'
          f'{" (dry run)" if dry else ""}\n')
    for m, d, k, _ in todo:
        print(f'  {m["date"]}  {m["committee"][:40]:<42}{d["title"][:60]}')
    if dry or not todo:
        if not todo and not dry:
            save_records(records)            # refresh the stamp: we looked, nothing new
            print(f'nothing new; stamp refreshed in {OUT}')
        return

    ok = failed = 0
    for i, (m, d, k, from_pack) in enumerate(todo, 1):
        label = f'[{i}/{len(todo)}] {m["date"]} {m["committee"][:36]} — {d["title"][:50]}'
        record = {'key': k, 'committee': m['committee'], 'date': m['date'],
                  'meetingId': m.get('id'), 'meetingUrl': m.get('url'),
                  'title': d['title'], 'url': d['url'], 'pack': is_pack(d['title']),
                  'read': stamp()}
        path = None
        try:
            path, size = fetch(d['url'])
            hits, pages, pages_with = count_pdf(path)
            record.update({'status': 'ok', 'bytes': size, 'pages': pages,
                           'hits': hits, 'pagesWithHits': pages_with})
            ok += 1
            print(f'{label}: {hits} mention(s) on {pages_with}/{pages} pages, {size // 1024} KB')
        except Exception as exc:
            record.update({'status': 'failed', 'error': str(exc)[:200]})
            failed += 1
            print(f'{label}: FAILED {exc}')
        finally:
            if path:
                try:
                    os.unlink(path)
                except OSError:
                    pass
        records[k] = record
        save_records(records)               # progress survives an interruption
        if i < len(todo):
            time.sleep(PAUSE)

    print(f'\n{ok} read, {failed} failed; {len(records)} record(s) in {OUT}')
    if todo and not ok:
        raise SystemExit('STOP: nothing could be fetched; is the council\'s site reachable?')


if __name__ == '__main__':
    main()
