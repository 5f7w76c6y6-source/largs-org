#!/usr/bin/env python3
"""Write the fuel-page CSS block into src/assets/css/site.css.

Supersedes add-fuel-css.py and patch-fuel-css.py -- delete both. This one
is idempotent: it REPLACES everything between the two marker comments, so
running it again after a change to this file just updates the block. No
anchors to go stale, no partial edits.

Nothing outside the markers is touched. Removing the page's styling
entirely is still a single delete between them.

Run from the repo root:
    python3 scripts/fuel-css.py
"""

import pathlib
import sys

CSS = pathlib.Path("src/assets/css/site.css")

START = "/* ---------- fuel prices ---------- */"
END = "/* ---------- end fuel prices ---------- */"

BLOCK = f"""{START}
/* Filling up around Largs. The whole block is self-contained: it adds
   selectors, it does not alter any. Delete from this marker to the closing
   one to remove the page's styling entirely. */

/* Standing notice. Funnel red, which the design system reserves for status
   and alerts. Its one use now is the noscript block: a page that cannot show
   prices needs to say so where it cannot be missed. */
.fuel-notice{{
  border:1px solid var(--red);border-left-width:5px;border-radius:8px;
  background:#FBEEEB;color:var(--ink);
  padding:11px 14px;margin:0 0 14px;font-size:.95rem;max-width:70ch;
}}
.fuel-notice strong{{color:var(--red)}}

/* Fuel chips. Same shape as the roadworks filter strip; the count slot
   carries the cheapest price for that grade, so the chip row doubles as
   an at-a-glance answer to "petrol or diesel, and how much?". */
.fuel-filter{{display:flex;flex-wrap:wrap;gap:8px;margin:14px 0 16px}}
.fuel-filter a{{
  display:inline-flex;align-items:center;gap:8px;
  padding:7px 14px;border:1px solid var(--sand);border-radius:999px;
  background:var(--card);color:var(--slate);text-decoration:none;
  font-size:.95rem;
}}
.fuel-filter a[aria-current="page"]{{background:var(--teal);border-color:var(--teal);color:var(--paper)}}
.fuel-filter .n{{font-family:"Spline Sans Mono",monospace;font-size:.85rem;opacity:.75}}
.fuel-filter a[aria-current="page"] .n{{opacity:.9}}

.fuel-legend{{
  font-family:"Spline Sans Mono",monospace;font-size:.7rem;color:var(--muted);
  letter-spacing:.04em;display:flex;gap:18px;align-items:center;flex-wrap:wrap;
  margin:10px 0 4px;
}}
.fuel-legend .swatch{{
  width:11px;height:11px;border-radius:50%;display:inline-block;
  margin-right:6px;vertical-align:-1px;border:2px solid var(--paper);
  box-shadow:0 0 0 1px var(--sand);
}}
.swatch.sells{{background:var(--teal)}}

/* Taller than the works map, and deliberately. The corridor is 39 km down
   and 16 km across, so a short wide box forces Leaflet to zoom out until
   the width is showing Arran and Falkirk. Every 100px of height here is
   most of a zoom level back. */
#fuel-map{{
  height:620px;border:1px solid var(--sand);border-radius:12px;
  margin:12px 0 20px;background:var(--foam-tint);
}}

/* Price pins. Every one identical -- no colour band, no highlight on the
   cheapest. The number is the fact; the reader ranks. Anything else would
   be the site passing judgement on a named local business.
   Kept compact: at a zoom that frames the whole corridor the Ardrossan and
   Irvine clusters overlap, and every millimetre of pill is more collision. */
.fuel-pin{{
  display:inline-block;min-width:46px;text-align:center;
  font-family:"Spline Sans Mono",monospace;font-size:.68rem;font-weight:600;
  padding:2px 4px;border-radius:999px;
  background:var(--teal);color:var(--paper);
  border:2px solid var(--paper);box-shadow:0 1px 3px rgba(0,0,0,.3);
  white-space:nowrap;
}}
/* The list. Price is the left column at size in the mono face, so the
   whole thing can be read down the left edge without reading a word. */
.fuel-row{{
  display:flex;gap:14px;padding:13px 0;
  border-bottom:1px solid var(--sand);align-items:baseline;
}}
.fuel-row:last-of-type{{border-bottom:none}}
.fuel-price{{
  flex:none;min-width:5.4rem;
  font-family:"Spline Sans Mono",monospace;font-size:1.32rem;font-weight:600;
  color:var(--slate);font-variant-numeric:tabular-nums;letter-spacing:-.01em;
}}
.fuel-price .pence{{font-size:.82rem;font-weight:400;color:var(--muted);margin-left:1px}}
/* The waiting state, before the fetch lands. Deliberately not a spinner and
   not a zero: three dots say "not yet" without implying a number. */
.fuel-price .pval{{color:var(--sand)}}
.fuel-price.has-price .pval{{color:var(--slate)}}
.fuel-price.none{{color:var(--sand)}}
.fuel-main{{flex:1}}
.fuel-main h3{{font-size:1.02rem;font-weight:700;color:var(--slate)}}
.fuel-where{{
  font-family:"Spline Sans Mono",monospace;font-size:.72rem;font-weight:500;
  letter-spacing:.08em;text-transform:uppercase;color:var(--teal);
  margin-left:7px;vertical-align:1px;
}}
.fuel-main .meta{{font-family:"Spline Sans Mono",monospace;font-size:.76rem;color:var(--muted);margin-top:2px}}
.fuel-row.nosell .fuel-main h3{{color:var(--muted);font-weight:500}}
.fuel-sub{{
  font-family:"Spline Sans Mono",monospace;font-size:.7rem;letter-spacing:.22em;
  text-transform:uppercase;color:var(--muted);margin:22px 0 2px;font-weight:500;
}}

/* Anchored from a map popup: the same teal flash the overhead page uses,
   so a reader who taps "full details" can see which row answered. */
.fuel-row:target{{background:var(--foam-tint);border-radius:8px}}

@media (max-width:600px){{
  /* A phone is narrow and tall, which suits a 39 km corridor far better
     than a desktop window does. Give it the height to use. */
  #fuel-map{{height:480px}}
  .fuel-price{{min-width:4.6rem;font-size:1.18rem}}
}}
{END}"""


def main():
    if not CSS.exists():
        sys.exit(f"STOP: {CSS} not found. Run this from the repo root.")

    text = CSS.read_text()

    if START in text and END in text:
        a = text.index(START)
        b = text.index(END) + len(END)
        if b <= a:
            sys.exit("STOP: markers are out of order in site.css. Nothing written.")
        CSS.write_text(text[:a] + BLOCK + text[b:])
        print(f"Replaced the fuel block in {CSS}.")
        return

    if START in text or END in text:
        sys.exit("STOP: only one of the two markers is present in site.css. "
                 "Fix by hand. Nothing written.")

    # First run: two sanity anchors, so we never append to the wrong file.
    for anchor in ("--slate:#17333A", ".works-filter{"):
        if anchor not in text:
            sys.exit(f"STOP: expected anchor {anchor!r} not found in {CSS}. "
                     "Nothing written.")

    CSS.write_text(text + "\n\n" + BLOCK + "\n")
    print(f"Appended the fuel block to {CSS}.")
    print(f"Remove it later by deleting from {START} to {END}.")


if __name__ == "__main__":
    main()
