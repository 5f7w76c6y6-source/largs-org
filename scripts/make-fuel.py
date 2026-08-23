#!/usr/bin/env python3
"""Build src/_data/fuel.json from the Fuel Finder recon fixture.

FIXTURE STAGE. This reads the frozen 23 August pull in
~/Developer/fuel-recon/fuel-corridor.json and writes a distillate the
page can render. Nothing here talks to the API. When the live wiring
lands, only the input changes -- the output shape below is the contract
and should not move without a schema bump.

Usage:
    python3 scripts/make-fuel.py                 # default paths
    python3 scripts/make-fuel.py IN.json OUT.json

Why the shape is what it is
---------------------------
The template does NO sorting and NO filtering. Everything is precomputed
into four ready-made views, one per fuel grade, each carrying its own
cheapest-first list. That keeps eleventy.config.js untouched, which
matters while the page is still on trial: if it gets binned, deleting
three files removes every trace.
"""

import json
import os
import sys
from datetime import datetime, timezone

HOME = os.path.expanduser("~")
IN = sys.argv[1] if len(sys.argv) > 1 else f"{HOME}/Developer/fuel-recon/fuel-corridor.json"
OUT = sys.argv[2] if len(sys.argv) > 2 else "src/_data/fuel.json"

# Bump when the shape below changes, so a stale file can never be served
# as though it were current. Same discipline as SRWR_DISRUPT_SCHEMA.
SCHEMA = 1

# ---------------------------------------------------------------------
# Grades.
#
# The register uses fuel-standard codes; forecourt signs do not. E10 is
# ordinary unleaded, E5 is super, B7 is diesel (7% biodiesel). Chips read
# in pump language and each card shows the code beside the price, so the
# page is usable without a decoder ring and still shows exactly what the
# register said.
#
# Order is by how many people buy it, not alphabetical.
# ---------------------------------------------------------------------
GRADES = [
    {"key": "E10",         "label": "Unleaded",       "path": "/fuel/"},
    {"key": "B7_STANDARD", "label": "Diesel",         "path": "/fuel/diesel/"},
    {"key": "E5",          "label": "Super unleaded", "path": "/fuel/super-unleaded/"},
    {"key": "B7_PREMIUM",  "label": "Premium diesel", "path": "/fuel/premium-diesel/"},
]

# ---------------------------------------------------------------------
# Postcode district -> locality.
#
# The register's own `city` field cannot be trusted for this: the Esso at
# Fairlie is filed under LARGS, and the Asda is filed under "ADROSSAN".
# A reader deciding where to stop needs the right town name, so it is
# derived from the postcode instead -- which the retailer cannot get
# wrong, because Royal Mail assigns it.
#
# Districts only. Add to this table when the box catches a new one; the
# script SHOUTS about anything it does not recognise rather than guessing.
# ---------------------------------------------------------------------
DISTRICTS = {
    "PA14": "Port Glasgow",
    "PA15": "Greenock",
    "PA16": "Greenock",
    "PA18": "Wemyss Bay",
    "KA30": "Largs",
    "KA29": "Fairlie",
    "KA25": "Kilbirnie",
    "KA15": "Beith",
    "KA13": "Kilwinning",
    "KA22": "Ardrossan",
    "KA21": "Saltcoats",
    "KA20": "Stevenston",
    "KA11": "Irvine",
    "KA12": "Irvine",
}

# Sector-level overrides, where a district spans two places people would
# name differently. KA11 is Irvine's, but Dreghorn is its own village and
# a driver heading for Irvine town centre would not expect to find it there.
SECTORS = {
    "KA11 4": "Dreghorn",
}

# Brands whose styling is not title case.
KEEP = {"BP", "MFG", "JET", "ASDA", "HVO"}
FIX = {
    "SAINSBURYS": "Sainsbury's",
    "SAINSBURY'S": "Sainsbury's",
    "MORRISONS": "Morrisons",
    "TESCO": "Tesco",
    "ESSO": "Esso",
    "GULF": "Gulf",
    "SHELL": "Shell",
    "TEXACO": "Texaco",
    "CO-OP": "Co-op",
}


def tidy(s):
    """Title-case a SHOUTED register string, leaving mixed case alone.

    The register is inconsistent -- 'GULF' and 'Esso' both appear -- so
    only strings that are entirely uppercase get touched. Anything the
    retailer has already cased deliberately is left as they wrote it.
    """
    s = (s or "").strip()
    if not s:
        return ""
    if s.upper() in FIX:
        return FIX[s.upper()]
    if s.upper() in KEEP:
        return s.upper()
    if s != s.upper():
        return s
    out = []
    for word in s.split():
        bare = word.strip("(),.")
        if bare in KEEP:
            out.append(word)
        elif bare in FIX:
            out.append(word.replace(bare, FIX[bare]))
        else:
            out.append(word.capitalize())
    return " ".join(out)


# Words that mean a record's address_line_1 is naming a thoroughfare.
# The register's first address line is only a street about two thirds of the
# time; the rest is the operating company ("Polygon Retailing Ltd"), the shop
# on the site ("Tesco Stores"), a bare number ("12"), or a repeat of the
# trading name ("Mayfield Filling Station"). None of those help a driver, and
# several read as though the site had made a mistake. So the line is shown
# only when one of its words is a street type -- matched whole, or PARKHOUSE
# and RAVENSPARK would both pass as "park".
STREET_WORDS = {
    "road", "rd", "street", "st", "drive", "avenue", "ave", "lane", "way",
    "place", "terrace", "crescent", "brae", "wynd", "court", "row", "park",
    "gardens", "quay", "harbour", "hill", "bank", "square", "close", "grove",
    "view", "loan", "vennel", "bridge", "cross", "mount", "walk",
}


def street_only(line):
    """Return the address line if it names a street, else empty."""
    line = (line or "").strip()
    if not line:
        return ""
    words = [w.strip("(),.-/").lower() for w in line.split()]
    return line if any(w in STREET_WORDS for w in words) else ""


def locality(postcode):
    """Town name from the postcode, or None if the table doesn't know it."""
    pc = (postcode or "").upper().replace(" ", "")
    if len(pc) < 5:
        return None
    # Outward code is everything before the last three characters.
    outward, inward = pc[:-3], pc[-3:]
    sector = f"{outward} {inward[0]}"
    if sector in SECTORS:
        return SECTORS[sector]
    return DISTRICTS.get(outward)


MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
          "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


def short_date(iso):
    """'2026-08-18T06:02:00.000Z' -> '18 Aug'. Empty if unparseable."""
    try:
        y, m, d = iso[:10].split("-")
        return f"{int(d)} {MONTHS[int(m) - 1]}"
    except Exception:
        return ""


def open_all_hours(times):
    """True only if every day of the week is flagged 24 hours.

    Treated with suspicion. In the 23 August pull most forecourts carry
    open 00:00:00, close 00:00:00 and is_24_hours false -- which is not a
    real answer to any question. So this returns True only on an explicit
    all-week flag, and the page says nothing at all otherwise rather than
    printing midnight-to-midnight as though it meant something.
    """
    days = ((times or {}).get("usual_days") or {})
    if len(days) < 7:
        return False
    return all(bool(d.get("is_24_hours")) for d in days.values())


def main():
    if not os.path.exists(IN):
        sys.exit(f"STOP: no fixture at {IN}\n"
                 f"Rescue it from /tmp, or re-run ff-pull.py with a fresh token.")

    raw = json.load(open(IN))
    # Two shapes, one reader. The recon pull wrote a bare array; the Worker
    # writes {ok, fetchedAt, stations:[...]} with the same records inside, so
    # its metadata rides alongside instead of contaminating the list.
    if isinstance(raw, dict) and isinstance(raw.get("stations"), list):
        raw = raw["stations"]
    if not isinstance(raw, list) or not raw:
        sys.exit(f"STOP: {IN} holds neither an array nor a stations list")

    stations, unknown, no_coords = [], set(), 0

    for r in raw:
        loc = r.get("location") or {}
        lat, lng = loc.get("latitude"), loc.get("longitude")
        if lat is None or lng is None:
            no_coords += 1
            continue

        pc = (loc.get("postcode") or "").upper().strip()
        # Some postcodes arrive unspaced ("PA238AL"). Normalise for display.
        if pc and " " not in pc and len(pc) > 3:
            pc = f"{pc[:-3]} {pc[-3:]}"

        town = locality(pc)
        if town is None:
            unknown.add(pc[:4] if pc else "(no postcode)")
            town = tidy(loc.get("city")) or ""

        brand = tidy(r.get("brand_name"))
        trading = tidy(r.get("trading_name"))
        # Brand is what is on the sign. Trading name is often the operating
        # company -- five of the corridor's forecourts trade as "Highland
        # Fuels Ltd" -- so it is never the headline.
        name = brand or trading

        prices = {}
        for fp in (r.get("fuel_prices") or []):
            ft, p = fp.get("fuel_type"), fp.get("price")
            if not ft or p is None:
                continue
            prices[ft] = {
                "p": float(p),
                # The EFFECTIVE timestamp, not price_last_updated: the
                # question a driver has is when the price became true at
                # the pump, not when the record was written.
                "at": fp.get("price_change_effective_timestamp")
                      or fp.get("price_last_updated"),
            }

        stations.append({
            "id": r.get("node_id"),
            "name": name,
            "trading": trading if trading and trading != name else "",
            "locality": town,
            "address": tidy(street_only(loc.get("address_line_1"))),
            "postcode": pc,
            "lat": round(float(lat), 5),
            "lng": round(float(lng), 5),
            "open24": open_all_hours(r.get("opening_times")),
            "closedTemp": bool(r.get("temporary_closure")),
            "closedPerm": bool(r.get("permanent_closure")),
            "prices": prices,
        })

    # ---- build one ready-made view per grade -------------------------
    # Frozen while the page runs on the 23 August pull. When the live loader
    # lands this becomes the moment the snapshot was taken, and `fixture`
    # below flips to False -- which is what removes the red banner.
    captured = "2026-08-23T08:40:00Z"

    views = []
    for g in GRADES:
        sold, not_sold = [], []
        for s in stations:
            # `prices` is the whole grade dict and `trading` is no longer
            # rendered -- both would only bloat the array this page dumps
            # into its map script.
            row = {k: v for k, v in s.items() if k not in ("prices", "trading")}
            hit = s["prices"].get(g["key"])
            if hit:
                row["price"] = hit["p"]
                # The display string is built HERE, not in the template.
                # Nunjucks' round(1) returns a number, so 158.0 renders as
                # "158" -- one row reading 158p in a column of 157.9p looks
                # rounded, and the whole point of the page is that the
                # tenths are real money. Always one decimal, always a string.
                row["priceText"] = f"{hit['p']:.1f}"
                row["priceAt"] = hit["at"]
                # A price is shown with a date ONLY when it was not reported
                # on the day this data was taken. An old timestamp does not
                # mean the figure is stale -- retailers must report a change
                # within 30 minutes, so no news is genuinely no change -- but
                # a price nobody has touched for a fortnight is worth seeing,
                # and it is the one signal that a retailer has stopped
                # reporting altogether. "Unchanged since" says that without
                # implying the site distrusts the number.
                row["setOn"] = ("" if (hit["at"] or "")[:10] == captured[:10]
                                else short_date(hit["at"] or ""))
                sold.append(row)
            else:
                # Kept, never dropped. A forecourt that does not sell this
                # grade still appears, marked. Omitting it would be
                # selective display, which the Fuel Finder fair use policy
                # forbids in terms -- and it would also mislead a reader
                # into thinking the town had fewer options than it has.
                not_sold.append(row)

        # Cheapest first; ties broken north to south so the order is
        # stable between builds rather than arbitrary.
        sold.sort(key=lambda x: (x["price"], -x["lat"]))
        not_sold.sort(key=lambda x: -x["lat"])

        views.append({**g, "sold": sold, "notSold": not_sold,
                      "cheapest": sold[0]["price"] if sold else None,
                      "cheapestText": sold[0]["priceText"] if sold else "",
                      "dearest": sold[-1]["price"] if sold else None})

    out = {
        "ok": True,
        "schema": SCHEMA,
        # True while the page runs on the frozen pull. The template keys
        # its "not live" banner off this, so wiring the API and forgetting
        # to remove the banner is impossible -- flip the flag, banner goes.
        "fixture": True,
        "capturedAt": captured,
        # Rendered by the template as-is; the page does no date arithmetic.
        "capturedText": short_date(captured),
        "builtAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "count": len(stations),
        "views": views,
    }

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    json.dump(out, open(OUT, "w"), indent=1)

    print(f"Wrote {OUT}")
    print(f"  {len(stations)} forecourts"
          + (f", {no_coords} skipped for missing coordinates" if no_coords else ""))
    for v in views:
        span = (f"{v['cheapest']:.1f}–{v['dearest']:.1f}p"
                if v["cheapest"] is not None else "none")
        print(f"  {v['label']:<15} {len(v['sold']):>2} selling, "
              f"{len(v['notSold']):>2} not  ({span})")

    if unknown:
        print("\n  POSTCODE DISTRICTS NOT IN THE TABLE: " + ", ".join(sorted(unknown)))
        print("  Those rows fell back to the register's own city field, which is")
        print("  unreliable. Add them to DISTRICTS above.")

    n24 = sum(1 for s in stations if s["open24"])
    print(f"\n  {n24} of {len(stations)} flagged open 24 hours "
          f"(the register's opening times look largely unfilled -- see open_all_hours)")


if __name__ == "__main__":
    main()
