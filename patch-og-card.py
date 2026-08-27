#!/usr/bin/env python3
"""
patch-og-card.py — turn on the Open Graph share card.

Two files, one transaction. Nothing is written unless every anchor in both
files is found exactly once and the resulting JSON still parses.

  site.json   ogImage, ogImageWidth, ogImageHeight, ogImageAlt
              (dimensions and alt live beside the path so that replacing
              the card is a one-place edit and the tags cannot drift out
              of step with the picture)

  base.njk    og:image:width / :height / :alt inside the existing
              {%- if site.ogImage %} guard, reading from site.json.
              twitter:card is already conditional and is left alone.

Run from the repo root:  python3 patch-og-card.py
"""

import json
import pathlib
import sys
import tempfile

# --------------------------------------------------------------------------
# The edits
# --------------------------------------------------------------------------

JSON_ANCHOR = (
    '  "_ogImage": "Set to a path like /assets/img/og.png once the 1200x630 '
    'share card exists. Left unset deliberately: an og:image pointing at '
    'nothing is worse than no card at all.",'
)

JSON_REPLACEMENT = (
    '  "_ogImage": "The share card, and the facts about it. The filename '
    'carries a version because Facebook and Cloudflare both cache an image '
    'against its URL: a replacement at the same path would keep showing the '
    'old card in shares for weeks. To change the card, add a new file and '
    'point this at it, then re-run Facebook\'s Sharing Debugger once.",\n'
    '  "ogImage": "/assets/img/og-2026-08.png",\n'
    '  "ogImageWidth": 2400,\n'
    '  "ogImageHeight": 1260,\n'
    '  "ogImageAlt": "largs.scot \\u2014 Magnus the Viking standing above the '
    'Largs horizon, with the Cumbrae ferry and the Pencil monument.",'
)

NJK_ANCHOR = (
    '<meta property="og:image" content="{{ site.url }}{{ site.ogImage }}">\n'
    '<meta name="twitter:card" content="summary_large_image">'
)

NJK_REPLACEMENT = (
    '<meta property="og:image" content="{{ site.url }}{{ site.ogImage }}">\n'
    '<meta property="og:image:width" content="{{ site.ogImageWidth }}">\n'
    '<meta property="og:image:height" content="{{ site.ogImageHeight }}">\n'
    '<meta property="og:image:alt" content="{{ site.ogImageAlt }}">\n'
    '<meta name="twitter:card" content="summary_large_image">'
)


def transform(text, anchor, replacement, label):
    """Replace anchor with replacement, refusing on any count but exactly one."""
    found = text.count(anchor)
    if found != 1:
        raise ValueError(
            f"{label}: anchor found {found} times, expected exactly 1. "
            "Nothing written."
        )
    return text.replace(anchor, replacement)


# --------------------------------------------------------------------------
# Self-test — the mock mirrors the real files' ORDERING, not just content,
# because a mock that reorders things can validate a patch that then fails
# on contact with the repo.
# --------------------------------------------------------------------------

MOCK_JSON = """{
  "title": "Largs — …for you",
  "_description": "Fallback meta description. Pages use their own `subtitle` unless they set `description` in front matter.",
  "description": "Everyday information for the town of Largs — bin days, tides, ferry and roadworks, what's on, and council business in plain English.",
""" + JSON_ANCHOR + """
  "url": "https://largs.scot",
  "links": {
    "calmacStatus": "https://www.calmac.co.uk/en-gb/service-status/",
    "rail": "https://www.nationalrail.co.uk"
  }
}
"""

MOCK_NJK = """<link rel="manifest" href="/site.webmanifest">

{# Open Graph comment block sits here in the real file. #}
<meta property="og:site_name" content="largs.scot">
<meta property="og:title" content="{{ metaTitle }}">
<meta property="og:description" content="{{ metaDesc }}">
<meta property="og:url" content="{{ site.url }}{{ page.url }}">
<meta property="og:type" content="website">
<meta property="og:locale" content="en_GB">
{%- if site.ogImage %}
""" + NJK_ANCHOR + """
{%- else %}
<meta name="twitter:card" content="summary">
{%- endif %}

<script type="application/ld+json">
</script>
"""


def self_test():
    out = transform(MOCK_JSON, JSON_ANCHOR, JSON_REPLACEMENT, "mock site.json")
    data = json.loads(out)
    assert data["ogImage"] == "/assets/img/og-2026-08.png", "ogImage not set"
    assert data["ogImageWidth"] == 2400, "width wrong"
    assert data["ogImageHeight"] == 1260, "height wrong"
    assert "Magnus" in data["ogImageAlt"], "alt text missing"
    assert data["url"] == "https://largs.scot", "later keys disturbed"

    out = transform(MOCK_NJK, NJK_ANCHOR, NJK_REPLACEMENT, "mock base.njk")
    assert out.count('og:image:width') == 1, "width tag not added once"
    assert out.count('name="twitter:card"') == 2, "twitter:card block disturbed"
    assert out.index('og:image:alt') < out.index('{%- else %}'), \
        "new tags landed outside the conditional"

    # Anchors must be gone afterwards, so a second run is a no-op that refuses
    # rather than a silent double-application.
    try:
        transform(out, NJK_ANCHOR, NJK_REPLACEMENT, "rerun")
    except ValueError:
        pass
    else:
        raise AssertionError("patch is not idempotent-safe: rerun would apply twice")

    return True


# --------------------------------------------------------------------------
# Apply
# --------------------------------------------------------------------------

def main():
    root = pathlib.Path.cwd()

    matches = sorted(root.glob("src/**/site.json"))
    if len(matches) != 1:
        sys.exit(f"REFUSED: expected exactly one src/**/site.json, found {len(matches)}")
    json_path = matches[0]

    njk_path = root / "src" / "_includes" / "layouts" / "base.njk"
    if not njk_path.is_file():
        sys.exit(f"REFUSED: {njk_path} not found. Run me from the repo root.")

    img = root / "src" / "assets" / "img" / "og-2026-08.png"
    if not img.is_file():
        sys.exit("REFUSED: src/assets/img/og-2026-08.png is not in place.")

    print("Self-test against a mock that mirrors the real ordering...")
    self_test()
    print("  passed")

    json_text = json_path.read_text(encoding="utf-8")
    njk_text = njk_path.read_text(encoding="utf-8")

    try:
        new_json = transform(json_text, JSON_ANCHOR, JSON_REPLACEMENT, str(json_path))
        json.loads(new_json)
        new_njk = transform(njk_text, NJK_ANCHOR, NJK_REPLACEMENT, str(njk_path))
    except (ValueError, json.JSONDecodeError) as err:
        sys.exit(f"REFUSED: {err}")

    json_path.write_text(new_json, encoding="utf-8")
    njk_path.write_text(new_njk, encoding="utf-8")

    print(f"  wrote {json_path}")
    print(f"  wrote {njk_path}")
    print("\nBoth files written. Now: npx eleventy")


if __name__ == "__main__":
    main()
