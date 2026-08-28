#!/usr/bin/env python3
"""
patch-contact-addresses.py — publish the site's own addresses.

Replaces the two published uses of largsevents@gmail.com with role
addresses on largs.scot:

  src/whats-on.njk   events@largs.scot   (2 occurrences: the inline link
                     in the intro, and the visible address further down)
  src/index.njk      letter@largs.scot   (1 occurrence: the Largs Letter
                     signup link)

Why role addresses rather than one: events submissions and the Letter list
are different jobs, and an address that names a function rather than a
person is the thing that lets someone else take this on later without
anything published having to change.

The gmail account stays alive and watched. Nothing anyone has already
saved will bounce; it simply stops being the address the site advertises.

Both files use long URL-encoded mailto bodies. This patch does not touch
them — it replaces only the literal address string, so the subject lines
and pre-filled templates survive exactly as written.

Run from the repo root:  python3 patch-contact-addresses.py
"""

import pathlib
import sys

OLD = "largsevents@gmail.com"

WHATS_ON = pathlib.Path("src/whats-on.njk")
INDEX = pathlib.Path("src/index.njk")

# path -> (replacement address, expected occurrences)
TARGETS = {
    WHATS_ON: ("events@largs.scot", 3),
    INDEX: ("letter@largs.scot", 1),
}


def transform(text, new, expected, label):
    found = text.count(OLD)
    if found != expected:
        raise ValueError(
            f"{label}: found {OLD} {found} times, expected exactly {expected}. "
            "Nothing written."
        )
    return text.replace(OLD, new)


# --------------------------------------------------------------------------
# Self-test. The mock keeps the real files' shape: the address appears both
# inside a URL-encoded href and as visible link text, and the encoded body
# must come through untouched.
# --------------------------------------------------------------------------

MOCK_WHATS_ON = (
    '  or <a href="mailto:largsevents@gmail.com?subject=Event%20submission'
    '%20for%20Largs&body=Title%3A%0ADate%3A">submit one</a>.</p>\n'
    '  <a href="mailto:largsevents@gmail.com?subject=Event%20submission'
    '%20for%20Largs&body=Title%3A%0ADate%3A">largsevents@gmail.com</a>\n'
)

MOCK_INDEX = (
    '      <a class="more" href="mailto:largsevents@gmail.com'
    '?subject=Largs%20Letter%20-%20please%20add%20me&body=Please%20add'
    '%20this%20address">Email to be added \u2192</a>\n'
)


def self_test():
    out = transform(MOCK_WHATS_ON, "events@largs.scot", 3, "mock whats-on")
    assert out.count("events@largs.scot") == 3, "not all three replaced"
    assert OLD not in out, "old address left behind"
    assert "subject=Event%20submission%20for%20Largs" in out, "subject lost"
    assert "body=Title%3A%0ADate%3A" in out, "encoded body damaged"
    assert ">events@largs.scot</a>" in out, "visible link text not updated"

    out = transform(MOCK_INDEX, "letter@largs.scot", 1, "mock index")
    assert out.count("letter@largs.scot") == 1, "not replaced"
    assert "subject=Largs%20Letter%20-%20please%20add%20me" in out, "subject lost"
    assert "Email to be added \u2192" in out, "link text damaged"

    # A rerun must refuse rather than silently do nothing surprising.
    try:
        transform(out, "letter@largs.scot", 1, "rerun")
    except ValueError:
        pass
    else:
        raise AssertionError("not idempotent-safe: a rerun would not refuse")

    return True


def main():
    missing = [p for p in TARGETS if not p.is_file()]
    if missing:
        sys.exit(
            "REFUSED: not found — " + ", ".join(str(p) for p in missing)
            + "\nRun me from the repo root."
        )

    print("Self-test against mocks that mirror the real markup...")
    self_test()
    print("  passed")

    # Read and transform everything before writing anything.
    staged = {}
    try:
        for path, (new, expected) in TARGETS.items():
            text = path.read_text(encoding="utf-8")
            staged[path] = transform(text, new, expected, str(path))
    except ValueError as err:
        sys.exit(f"REFUSED: {err}")

    for path, text in staged.items():
        path.write_text(text, encoding="utf-8")
        print(f"  wrote {path} -> {TARGETS[path][0]}")

    # Anything still publishing the gmail address is worth knowing about.
    leftovers = []
    for f in pathlib.Path("src").rglob("*"):
        if f.suffix not in {".njk", ".md", ".json", ".html"} or not f.is_file():
            continue
        if OLD in f.read_text(encoding="utf-8", errors="ignore"):
            leftovers.append(str(f))

    if leftovers:
        print("\n  Still publishing the gmail address:")
        for f in leftovers:
            print(f"    {f}")
    else:
        print("\n  No remaining references to the gmail address in src/.")

    print("\nNow: npx eleventy\n")


if __name__ == "__main__":
    main()
