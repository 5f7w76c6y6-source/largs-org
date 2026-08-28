#!/usr/bin/env python3
"""
patch-og-resize.py — point the share card at the 1200x630 version.

The original capture was 2400x1260, a clean 2x of the intended size.
Facebook's Sharing Debugger and WhatsApp both render it correctly, but
Messenger shows only the title and description. Facebook documents
1200x630 as the size to use, so this ships that instead.

Honest note on why: this is an inference, not a proven cause. Nothing is
blocking the image — it returns 200 to Facebook's own user-agent, and the
Debugger displays it. Messenger being stricter about dimensions is the
best remaining explanation. If it does not fix Messenger, no harm is done:
1200x630 is the documented standard and the smaller file is quicker to
fetch.

New filename per the standing artwork rule, so no cache anywhere serves
the old one. The 2400px version stays in the repo; nothing points at it.

Run from the repo root, after copying the new PNG into src/assets/img/:
    python3 patch-og-resize.py
"""

import json
import pathlib
import sys

JSON_PATH = None  # located at run time
IMG = pathlib.Path("src/assets/img/og-2026-08b.png")

ANCHOR = '''  "ogImage": "/assets/img/og-2026-08.png",
  "ogImageWidth": 2400,
  "ogImageHeight": 1260,'''

REPLACEMENT = '''  "ogImage": "/assets/img/og-2026-08b.png",
  "ogImageWidth": 1200,
  "ogImageHeight": 630,'''


def transform(text, label):
    found = text.count(ANCHOR)
    if found != 1:
        raise ValueError(
            f"{label}: image block found {found} times, expected exactly 1. "
            "Nothing written."
        )
    return text.replace(ANCHOR, REPLACEMENT)


# --------------------------------------------------------------------------
# Self-test. The mock mirrors the real file: the three image keys sit
# together, preceded by the explanatory _ogImage note and followed by url.
# --------------------------------------------------------------------------

MOCK = '''{
  "title": "Largs — …for you",
  "description": "Everyday information for the town of Largs.",
  "_ogImage": "The share card, and the facts about it.",
''' + ANCHOR + '''
  "ogImageAlt": "largs.scot \\u2014 Magnus the Viking standing above the Largs horizon.",
  "url": "https://largs.scot"
}
'''


def self_test():
    out = transform(MOCK, "mock site.json")
    data = json.loads(out)

    assert data["ogImage"] == "/assets/img/og-2026-08b.png", "path not updated"
    assert data["ogImageWidth"] == 1200, "width not updated"
    assert data["ogImageHeight"] == 630, "height not updated"
    assert "Magnus" in data["ogImageAlt"], "alt text disturbed"
    assert data["url"] == "https://largs.scot", "later keys disturbed"
    assert data["title"] == "Largs — …for you", "earlier keys disturbed"

    try:
        transform(out, "rerun")
    except ValueError:
        pass
    else:
        raise AssertionError("not idempotent-safe: a rerun would apply twice")

    return True


def main():
    root = pathlib.Path.cwd()

    matches = sorted(root.glob("src/**/site.json"))
    if len(matches) != 1:
        sys.exit(f"REFUSED: expected one src/**/site.json, found {len(matches)}")
    json_path = matches[0]

    if not IMG.is_file():
        sys.exit(
            f"REFUSED: {IMG} not in place.\n"
            "Run: cp /tmp/og-2026-08b.png src/assets/img/og-2026-08b.png"
        )

    print("Self-test against a mock that mirrors the real file...")
    self_test()
    print("  passed")

    text = json_path.read_text(encoding="utf-8")
    try:
        new_text = transform(text, str(json_path))
        json.loads(new_text)
    except (ValueError, json.JSONDecodeError) as err:
        sys.exit(f"REFUSED: {err}")

    json_path.write_text(new_text, encoding="utf-8")
    print(f"  wrote {json_path}")
    print("\nNow: npx eleventy\n")


if __name__ == "__main__":
    main()
