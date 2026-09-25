#!/usr/bin/env python3
# Qubixer-1090 → largs.scot ships relay.
#
# Holds one WebSocket to aisstream.io for a box around the Largs Channel,
# keeps a table of every vessel heard in the last ten minutes, and every
# PUSH_INTERVAL seconds PUTs that table to the site's ingest endpoint,
# which stores it in R2 (functions/api/ships-ingest.js). The page reads
# /api/ships. Same shape as push-overhead.sh, same key file, same bucket:
# nothing new to create in the Cloudflare dashboard.
#
# WHY A PROCESS AND NOT A TIMER. aisstream is a stream, not a poll: it
# pushes each AIS message as the receivers hear it, and it will not accept
# a browser connection ("connect from your own server and proxy only what
# your clients need"). So this runs as a systemd service, reconnects when
# the socket drops, and the snapshot it writes is the only thing the site
# ever sees. Positions are as broadcast by the vessels themselves; names
# and types come from the vessels' own static messages (and aisstream's
# cache of them, delivered as MetaData with each position).
#
# NOW, NEVER HISTORY (Ian's ruling, 25 Sep 2026). The table forgets a
# vessel MAX_AGE seconds after its last position; nothing is written to
# disk; the snapshot is overwritten every push. Private yachts are named
# as they broadcast, which is the norm on every public tracker.
#
# Secrets: AISSTREAM_KEY from /etc/largs-ships.env (mode 600; the unit
# file passes it as an environment variable), the ingest key from
# /etc/largs-overhead.key. Neither is ever in this file or the repo.
#
# Budget: 20 s = ~130k R2 writes a month. With the aircraft relay's
# ~518k at 5 s that is ~650k against a 1,000,000 free allowance. Do not
# go below 15 s without redoing this sum.
#
#     apt install python3-websockets            # once
#     python3 ships.py --listen                 # 40 s of what it hears, no push
#     systemctl enable --now largs-ships        # the real thing
#
# Requires python3-websockets 10 or newer (Debian bookworm ships 10.4).

import asyncio
import json
import math
import os
import signal
import sys
import time
import urllib.request

try:
    import websockets
except ImportError:
    sys.exit("STOP: python3-websockets is not installed. Run: apt install python3-websockets")

STREAM = "wss://stream.aisstream.io/v0/stream"
INGEST = "https://largs-org.pages.dev/api/ships-ingest"
KEY_FILE = "/etc/largs-overhead.key"           # shared with the aircraft relay
UA = "qubixer-1090-relay/1.0 (largs.scot community site)"

HOME_LAT, HOME_LON = 55.795, -4.87              # Largs pierhead
# Subscription box: Ardrossan to Gourock, Arran's east coast to the shore.
# aisstream wants [[lat, lon], [lat, lon]] corners; order does not matter.
BOX = [[55.55, -5.35], [56.00, -4.70]]
RADIUS_NM = 15.0                                # what the snapshot keeps
MAX_AGE_S = 600                                 # forget a vessel after this
PUSH_INTERVAL_S = 20
STATIC_TYPES = ("ShipStaticData", "StaticDataReport")
POSITION_TYPES = ("PositionReport", "StandardClassBPositionReport",
                  "ExtendedClassBPositionReport")

vessels = {}                                    # mmsi -> dict
stats = {"messages": 0, "positions": 0, "statics": 0, "pushed": 0,
         "push_failed": 0, "connected_at": None, "last_message": None}


def read_ingest_key():
    try:
        with open(KEY_FILE, encoding="utf-8") as f:
            key = f.read().strip()
    except OSError:
        sys.exit(f"STOP: cannot read {KEY_FILE}")
    if not key:
        sys.exit(f"STOP: {KEY_FILE} is empty")
    return key


def dist_nm(la1, lo1, la2, lo2):
    f1, f2 = math.radians(la1), math.radians(la2)
    df, dl = math.radians(la2 - la1), math.radians(lo2 - lo1)
    a = math.sin(df / 2) ** 2 + math.cos(f1) * math.cos(f2) * math.sin(dl / 2) ** 2
    return 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a)) * 3440.065


def bearing_deg(la1, lo1, la2, lo2):
    f1, f2, dl = math.radians(la1), math.radians(la2), math.radians(lo2 - lo1)
    y = math.sin(dl) * math.cos(f2)
    x = math.cos(f1) * math.sin(f2) - math.sin(f1) * math.cos(f2) * math.cos(dl)
    return (math.degrees(math.atan2(y, x)) + 360) % 360


def clean(s):
    """AIS pads text with @ and spaces; strip both."""
    return str(s or "").replace("@", "").strip()


def vessel(mmsi):
    v = vessels.get(mmsi)
    if v is None:
        v = vessels[mmsi] = {"mmsi": mmsi}
    return v


def on_position(meta, body, now):
    lat = body.get("Latitude", meta.get("latitude"))
    lon = body.get("Longitude", meta.get("longitude"))
    if not isinstance(lat, (int, float)) or not isinstance(lon, (int, float)):
        return
    if abs(lat) > 90 or abs(lon) > 180:
        return                                   # 91/181 = "not available"
    mmsi = body.get("UserID") or meta.get("MMSI")
    if not mmsi:
        return
    v = vessel(mmsi)
    v["lat"] = round(lat, 5)
    v["lon"] = round(lon, 5)
    sog = body.get("Sog")
    v["sog"] = round(sog, 1) if isinstance(sog, (int, float)) and sog < 102.3 else None
    cog = body.get("Cog")
    v["cog"] = round(cog) % 360 if isinstance(cog, (int, float)) and cog < 360 else None
    hdg = body.get("TrueHeading")
    v["hdg"] = hdg if isinstance(hdg, int) and 0 <= hdg < 360 else None
    if "NavigationalStatus" in body:
        v["nav"] = body["NavigationalStatus"]
    name = clean(meta.get("ShipName"))
    if name and not v.get("name"):
        v["name"] = name
    v["seen"] = now
    stats["positions"] += 1


def on_static(kind, meta, body, now):
    mmsi = body.get("UserID") or meta.get("MMSI")
    if not mmsi:
        return
    v = vessel(mmsi)
    if kind == "ShipStaticData":
        name = clean(body.get("Name"))
        if name:
            v["name"] = name
        if isinstance(body.get("Type"), int):
            v["type"] = body["Type"]
        dest = clean(body.get("Destination"))
        if dest:
            v["dest"] = dest
        cs = clean(body.get("CallSign"))
        if cs:
            v["callsign"] = cs
        dim = body.get("Dimension") or {}
        if all(isinstance(dim.get(k), int) for k in ("A", "B", "C", "D")):
            v["length"] = dim["A"] + dim["B"]
            v["beam"] = dim["C"] + dim["D"]
        draught = body.get("MaximumStaticDraught")
        if isinstance(draught, (int, float)) and draught > 0:
            v["draught"] = round(draught, 1)
    else:                                        # StaticDataReport, Class B, two parts
        a = body.get("ReportA") or {}
        b = body.get("ReportB") or {}
        name = clean(a.get("Name"))
        if name:
            v["name"] = name
        if isinstance(b.get("ShipType"), int):
            v["type"] = b["ShipType"]
        cs = clean(b.get("CallSign"))
        if cs:
            v["callsign"] = cs
        dim = b.get("Dimension") or {}
        if all(isinstance(dim.get(k), int) for k in ("A", "B", "C", "D")) and (dim["A"] + dim["B"]):
            v["length"] = dim["A"] + dim["B"]
            v["beam"] = dim["C"] + dim["D"]
    v["static_seen"] = now
    stats["statics"] += 1


def handle(raw, now):
    try:
        msg = json.loads(raw)
    except ValueError:
        return
    kind = msg.get("MessageType")
    meta = msg.get("MetaData") or {}
    body = (msg.get("Message") or {}).get(kind) or {}
    stats["messages"] += 1
    stats["last_message"] = now
    if kind in POSITION_TYPES:
        on_position(meta, body, now)
    elif kind in STATIC_TYPES:
        on_static(kind, meta, body, now)


def snapshot(now):
    """Vessels with a position in the last MAX_AGE_S, within RADIUS_NM,
    closest first. Everything the page shows is in here and nothing else."""
    out = []
    for mmsi, v in list(vessels.items()):
        seen = v.get("seen")
        if seen is None:
            if now - v.get("static_seen", now) > MAX_AGE_S:
                del vessels[mmsi]                # static data for a boat never positioned
            continue
        if now - seen > MAX_AGE_S:
            del vessels[mmsi]
            continue
        d = dist_nm(HOME_LAT, HOME_LON, v["lat"], v["lon"])
        if d > RADIUS_NM:
            continue
        row = {
            "mmsi": mmsi,
            "name": v.get("name") or None,
            "type": v.get("type"),
            "lat": v["lat"], "lon": v["lon"],
            "sog": v.get("sog"), "cog": v.get("cog"), "hdg": v.get("hdg"),
            "nav": v.get("nav"),
            "dest": v.get("dest") or None,
            "callsign": v.get("callsign") or None,
            "length": v.get("length"), "beam": v.get("beam"),
            "draught": v.get("draught"),
            "dst": round(d, 1),
            "dir": round(bearing_deg(HOME_LAT, HOME_LON, v["lat"], v["lon"])),
            "seen_s": int(now - seen),
        }
        out.append({k: val for k, val in row.items() if val is not None})
    out.sort(key=lambda r: r["dst"])
    return {"now": int(now * 1000), "source": "aisstream.io",
            "radius_nm": RADIUS_NM, "max_age_s": MAX_AGE_S, "vessels": out}


def push(body, key):
    req = urllib.request.Request(
        INGEST, data=body.encode("utf-8"), method="PUT",
        headers={"x-overhead-key": key, "content-type": "application/json",
                 "user-agent": UA})
    with urllib.request.urlopen(req, timeout=10) as r:
        r.read()


async def pusher(key, stop):
    loop = asyncio.get_running_loop()
    while not stop.is_set():
        try:
            await asyncio.wait_for(stop.wait(), timeout=PUSH_INTERVAL_S)
        except asyncio.TimeoutError:
            pass
        if stop.is_set():
            break
        # Push even when nothing has been heard for a while: the snapshot's
        # `now` is how the page tells "quiet water" from "relay down". But
        # if the socket itself has been silent past MAX_AGE, say nothing
        # rather than stamp an empty table as fresh.
        last = stats["last_message"]
        if last is None or time.time() - last > MAX_AGE_S:
            continue
        body = json.dumps(snapshot(time.time()), separators=(",", ":"))
        try:
            await loop.run_in_executor(None, push, body, key)
            stats["pushed"] += 1
        except Exception as exc:              # any failure: next cycle tries again
            stats["push_failed"] += 1
            print(f"push failed: {exc}", flush=True)


async def listen(api_key, stop, listen_only=False, seconds=40):
    sub = {"APIKey": api_key, "BoundingBoxes": [BOX],
           "FilterMessageTypes": list(POSITION_TYPES + STATIC_TYPES)}
    backoff = 5
    started = time.time()
    while not stop.is_set():
        try:
            async with websockets.connect(STREAM, ping_interval=20, ping_timeout=20,
                                          max_size=1 << 20) as ws:
                await ws.send(json.dumps(sub))    # must arrive within 3 s
                stats["connected_at"] = time.time()
                print("connected; subscribed to the Largs box", flush=True)
                backoff = 5
                async for raw in ws:
                    handle(raw, time.time())
                    if listen_only and time.time() - started > seconds:
                        return
                    if stop.is_set():
                        return
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            if listen_only and time.time() - started > seconds:
                return
            print(f"socket: {exc}; reconnecting in {backoff}s", flush=True)
            try:
                await asyncio.wait_for(stop.wait(), timeout=backoff)
            except asyncio.TimeoutError:
                pass
            backoff = min(backoff * 2, 120)


def report():
    now = time.time()
    snap = snapshot(now)
    print(f"\n{stats['messages']} messages, {stats['positions']} positions, "
          f"{stats['statics']} static; {len(snap['vessels'])} vessel(s) within "
          f"{RADIUS_NM:g} nm of Largs, {len(vessels)} in the box:")
    for v in snap["vessels"]:
        print(f"  {v.get('name') or v['mmsi']:<22} type {v.get('type', '?'):<3} "
              f"{v['dst']:>4.1f} nm {v['dir']:>3}°  {v.get('sog', '-')} kn"
              f"  → {v.get('dest', '')}")


async def main():
    listen_only = "--listen" in sys.argv
    api_key = os.environ.get("AISSTREAM_KEY", "").strip()
    if not api_key:
        # the unit file passes it; a shell test can source the file first
        try:
            with open("/etc/largs-ships.env", encoding="utf-8") as f:
                for line in f:
                    if line.startswith("AISSTREAM_KEY="):
                        api_key = line.split("=", 1)[1].strip().strip('"')
        except OSError:
            pass
    if not api_key:
        sys.exit("STOP: AISSTREAM_KEY is not set (see /etc/largs-ships.env)")
    ingest_key = None if listen_only else read_ingest_key()

    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGTERM, signal.SIGINT):
        loop.add_signal_handler(sig, stop.set)

    tasks = [asyncio.create_task(listen(api_key, stop, listen_only))]
    if not listen_only:
        tasks.append(asyncio.create_task(pusher(ingest_key, stop)))
    if listen_only:
        await tasks[0]
        report()
        return
    await asyncio.gather(*tasks)


if __name__ == "__main__":
    asyncio.run(main())
