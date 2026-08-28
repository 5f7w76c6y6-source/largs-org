#!/usr/bin/env python3
"""
patch-footer-corrections.py — invite corrections from every page.

Adds one line to the footer's "About this site" block:

    Spotted a mistake? corrections@largs.scot

Why here rather than the colophon: the colophon is attribution and small
print. The foot-meta block is the part of the footer a reader actually
reads, and an invitation to correct the site belongs where it will be
seen rather than where it can be pointed at later.

Why at all: the footer already claims every figure is "fetched live,
sourced to a public record, or labelled honestly". That is half of an
honesty commitment. The other half is a way to be told when it is wrong,
and until now the site had none — the word "correction" appeared nowhere
in src/.

The mailto carries a subject line so a correction arrives labelled, and
lands at a role address rather than a person, so it can still be answered
when someone else is running this.

Run from the repo root:  python3 patch-footer-corrections.py
"""

import pathlib
import sys

BASE = pathlib.Path("src/_includes/layouts/base.njk")

ANCHOR = """      <div class="foot-meta">
        <h4>About this site</h4>
        <p>Community-run, for the town, free to use.<br>
        <a href="/council/">Largs Community Council</a> · <a href="/on-the-agenda/">North Ayrshire Council</a> · <a href="/roadworks/">Roadworks</a></p>
      </div>"""

REPLACEMENT = """      <div class="foot-meta">
        <h4>About this site</h4>
        <p>Community-run, for the town, free to use.<br>
        <a href="/council/">Largs Community Council</a> · <a href="/on-the-agenda/">North Ayrshire Council</a> · <a href="/roadworks/">Roadworks</a></p>
        {# The other half of the accuracy claim made above: a way to be told
           when this site is wrong. A role address, not a person, so it can
           still be answered by whoever is running this in ten years. #}
        <p>Spotted a mistake? Tell us — <a href="mailto:corrections@largs.scot?subject=Correction%20for%20largs.scot&body=Which%20page%3A%0AWhat%20is%20wrong%3A%0AWhat%20it%20should%20say%20(if%20you%20know)%3A">corrections@largs.scot</a></p>
      </div>"""


def transform(text, label):
    found = text.count(ANCHOR)
    if found != 1:
        raise ValueError(
            f"{label}: footer block found {found} times, expected exactly 1. "
            "Nothing written."
        )
    return text.replace(ANCHOR, REPLACEMENT)


# --------------------------------------------------------------------------
# Self-test. The mock keeps the real file's shape: the foot-meta block sits
# between the founder block and the colophon, and both must survive.
# --------------------------------------------------------------------------

MOCK = """<footer>
  <div class="wrap">
    <div class="foot">
      <div class="founder">
        <h3>Built for the town</h3>
        <p>A community reference site for Largs.</p>
      </div>
""" + ANCHOR + """
    </div>
    <div class="colophon">
      <span><a href="/">largs.scot</a> · …for you</span>
    </div>
  </div>
</footer>
"""


def self_test():
    out = transform(MOCK, "mock base.njk")

    assert out.count("corrections@largs.scot") == 2, "address not added twice (href + text)"
    assert "Spotted a mistake?" in out, "invitation missing"
    assert out.count('<div class="foot-meta">') == 1, "block duplicated"
    assert "Built for the town" in out, "founder block disturbed"
    assert '<div class="colophon">' in out, "colophon disturbed"
    assert out.count('<a href="/council/">') == 1, "existing links disturbed"
    assert "subject=Correction%20for%20largs.scot" in out, "subject lost"

    # The new line must land inside foot-meta, not after it.
    assert out.index("Spotted a mistake?") < out.index('<div class="colophon">'), \
        "corrections line landed outside the footer block"

    try:
        transform(out, "rerun")
    except ValueError:
        pass
    else:
        raise AssertionError("not idempotent-safe: a rerun would apply twice")

    return True


def main():
    if not BASE.is_file():
        sys.exit(f"REFUSED: {BASE} not found. Run me from the repo root.")

    print("Self-test against a mock that mirrors the real footer...")
    self_test()
    print("  passed")

    text = BASE.read_text(encoding="utf-8")
    try:
        new_text = transform(text, str(BASE))
    except ValueError as err:
        sys.exit(f"REFUSED: {err}")

    BASE.write_text(new_text, encoding="utf-8")
    print(f"  wrote {BASE}")
    print("\nNow: npx eleventy\n")


if __name__ == "__main__":
    main()
