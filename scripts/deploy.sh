#!/usr/bin/env bash
# Build and install the Home Screen app and the hub service on the TV.
# Usage: TV_IP=192.168.1.50 scripts/deploy.sh
# The service gets the phone pages (static/phone.html, static/play.html, static/games/),
# static/icon.png and the pairing key (.tv_key),
# which is copied in at build time only and never committed.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STAGE="$ROOT/.devmode/stage-hub"
mkdir -p "$STAGE/app" "$STAGE/service/static"

rsync -a --delete "$ROOT/apps/home/" "$STAGE/app/"
rsync -a --delete --exclude static "$ROOT/services/home/" "$STAGE/service/"
cp "$ROOT/static/phone.html" "$STAGE/service/static/phone.html"
cp "$ROOT/static/play.html" "$STAGE/service/static/play.html"
cp "$ROOT/static/sound.js" "$STAGE/service/static/sound.js"
rsync -a --delete "$ROOT/static/games/" "$STAGE/service/static/games/"
cp "$ROOT/static/icon.png" "$STAGE/service/static/icon.png"
cp "$ROOT/.tv_key" "$STAGE/service/tv_key"

# A running service keeps the old code; ask it to quit so the new one starts on launch.
ssh -F "$ROOT/.devmode/ssh_config" lgtv \
  '(luna-send-pub -i luna://com.lgtvfastest.home.service/quit "{}" >/dev/null 2>&1 & p=$!; sleep 2; kill $p 2>/dev/null)' || true

"$ROOT/scripts/deploy-app.sh" "$STAGE/app" "$STAGE/service"
