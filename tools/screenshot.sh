#!/usr/bin/env bash
# screenshot.sh — headless Chromium screenshot of the game, no npm needed.
#   tools/screenshot.sh out.png "seed=42&turns=30&overlay=flow&notips=1"
set -euo pipefail

OUT="${1:-/tmp/tycoon.png}"
QUERY="${2:-seed=42&notips=1}"
CHROME="${CHROME:-$(ls /opt/pw-browsers/chromium-*/chrome-linux/chrome 2>/dev/null | head -1)}"
[ -x "$CHROME" ] || { echo "Chromium not found; set CHROME=/path/to/chrome" >&2; exit 1; }

DIR="$(cd "$(dirname "$0")/.." && pwd)"
"$CHROME" --headless=new --disable-gpu --no-sandbox \
  --window-size=1600,1000 --hide-scrollbars \
  --virtual-time-budget=10000 \
  --screenshot="$OUT" \
  "file://$DIR/index.html?$QUERY" 2>/dev/null
echo "wrote $OUT"
