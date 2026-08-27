#!/bin/sh
# Qubixer-1090 → largs.org overhead relay.
#
# Fetches the Largs box from adsb.lol over this machine's home broadband
# — where we are a recognised residential feeder and the request is
# answered — and PUTs it to the site's ingest endpoint, which stores it
# in R2. The site then serves from its own storage instead of asking
# services that refuse Cloudflare's egress addresses.
#
# Reads the shared secret from /etc/largs-overhead.key (chmod 600).
# Never put the key in this file, and never commit it anywhere.
#
# Deliberately quiet and forgiving: any failure is skipped, the next
# cycle tries again, and the site's own staleness handling covers gaps.

set -u

KEY_FILE=/etc/largs-overhead.key
SOURCE='https://api.adsb.lol/v2/lat/55.795/lon/-4.87/dist/30'
INGEST='https://largs-org.pages.dev/api/overhead-ingest'
# 5 s = ~518k R2 writes/month against a 1,000,000 free allowance.
# 10 s = ~259k. 3 s = ~864k (no headroom). Do not go below 3.
INTERVAL=5

[ -r "$KEY_FILE" ] || { echo "missing $KEY_FILE" >&2; exit 1; }
KEY=$(cat "$KEY_FILE")
[ -n "$KEY" ] || { echo "empty key" >&2; exit 1; }

while true; do
  DATA=$(curl -fsS --max-time 8 \
    -H 'user-agent: qubixer-1090-relay/1.0 (largs.org community site)' \
    "$SOURCE" 2>/dev/null)

  if [ -n "${DATA:-}" ]; then
    printf '%s' "$DATA" | curl -fsS --max-time 8 -X PUT \
      -H "x-overhead-key: $KEY" \
      -H 'content-type: application/json' \
      --data-binary @- \
      "$INGEST" >/dev/null 2>&1 || true
  fi

  sleep "$INTERVAL"
done
