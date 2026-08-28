#!/usr/bin/env python3
"""
patch-corrections-address.py — give the corrections policy a door.

The "If something here is wrong" section on /council/how-this-works/
already sets out what happens to a correction: a misreading is checked
against the source and fixed, an accurate record of a public decision is
not removed, wording that reads unfairly can be revisited. What it never
says is where to send one.

This adds the address to the end of that first paragraph, so the promise
and the route to acting on it sit in the same sentence rather than the
reader having to hunt for the footer.

The footer line stays as it is. This is not a duplicate: the footer is
for anything on the site, this is for the register specifically, and a
reader who has just been told mistakes are possible should not have to
scroll to find out what to do about it.

Run from the repo root:  python3 patch-corrections-address.py
"""

import pathlib
import sys

PAGE = pathlib.Path("src/council-how-this-works.njk")

ANCHOR = """  <p>Mistakes are possible — this is one person reading minutes carefully, not
  an institution. If an entry misreads what the minutes say, or a name or date
  is wrong, it will be checked against the source and corrected.</p>"""

REPLACEMENT = """  <p>Mistakes are possible — this is one person reading minutes carefully, not
  an institution. If an entry misreads what the minutes say, or a name or date
  is wrong, it will be checked against the source and corrected. Write to
  <a href="mailto:corrections@largs.scot?subject=Correction%20to%20the%20Largs%20Community%20Council%20register&body=Which%20entry%3A%0AWhat%20is%20wrong%3A%0AWhat%20the%20minutes%20say%20(if%20you%20know)%3A">corrections@largs.scot</a>
  and say which entry.</p>"""


def transform(text, label):
    found = text.count(ANCHOR)
    if found != 1:
        raise ValueError(
            f"{label}: paragraph found {found} times, expected exactly 1. "
            "Nothing written."
        )
    return text.replace(ANCHOR, REPLACEMENT)


# --------------------------------------------------------------------------
# Self-test. The mock keeps the section's real shape: the paragraph sits
# inside the "If something here is wrong" section, followed by the paragraph
# about what cannot be done and the volunteer note. All must survive.
# --------------------------------------------------------------------------

MOCK = """<section class="wrap council-page council-last" aria-labelledby="wrong-h">
  <h2 id="wrong-h">If something here is wrong</h2>
  <div class="rule" aria-hidden="true"></div>

""" + ANCHOR + """

  <p>What cannot be done is removing an accurate record of a public decision
  from a public meeting.</p>

  <p class="cc-note">This site is run by a volunteer and is not part of Largs
  Community Council or North Ayrshire Council.</p>

  <a class="more" href="/council/">← Back to Largs Community Council</a>
</section>
"""


def self_test():
    out = transform(MOCK, "mock how-this-works")

    assert out.count("corrections@largs.scot") == 2, "address not added twice (href + text)"
    assert "and say which entry." in out, "closing phrase missing"
    assert "checked against the source and corrected." in out, "promise damaged"
    assert "What cannot be done" in out, "following paragraph disturbed"
    assert "cc-note" in out, "volunteer note disturbed"
    assert 'href="/council/"' in out, "back link disturbed"
    assert out.count("<p>Mistakes are possible") == 1, "paragraph duplicated"

    # The address must land inside the section, before the note that follows.
    assert out.index("corrections@largs.scot") < out.index("What cannot be done"), \
        "address landed after the wrong paragraph"

    try:
        transform(out, "rerun")
    except ValueError:
        pass
    else:
        raise AssertionError("not idempotent-safe: a rerun would apply twice")

    return True


def main():
    if not PAGE.is_file():
        sys.exit(f"REFUSED: {PAGE} not found. Run me from the repo root.")

    print("Self-test against a mock that mirrors the real section...")
    self_test()
    print("  passed")

    text = PAGE.read_text(encoding="utf-8")
    try:
        new_text = transform(text, str(PAGE))
    except ValueError as err:
        sys.exit(f"REFUSED: {err}")

    PAGE.write_text(new_text, encoding="utf-8")
    print(f"  wrote {PAGE}")
    print("\nNow: npx eleventy\n")


if __name__ == "__main__":
    main()
