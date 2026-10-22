#!/usr/bin/env bash
# Package a webOS web app, install it on the TV over Developer Mode SSH, and launch it.
# Usage: scripts/deploy-app.sh apps/<name> [services/<name> ...]
# Set TV_IP to the TV address, e.g. TV_IP=192.168.1.50 scripts/deploy-app.sh apps/home
# Needs: .devmode/ssh_config (host "lgtv"), the LG CLI in .devmode/tools, .tv_key (SSAP pairing) and Node.js.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP_DIR="${1:?usage: $0 apps/<name> [services/<name> ...]}"
shift
TV_IP="${TV_IP:?set TV_IP to the TV address, e.g. TV_IP=192.168.1.50}"
SSH=(ssh -F "$ROOT/.devmode/ssh_config" lgtv)
BUILD="$ROOT/.devmode/build"

APP_ID="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["id"])' "$APP_DIR/appinfo.json")"
mkdir -p "$BUILD"
rm -f "$BUILD/${APP_ID}"_*.ipk
"$ROOT/.devmode/tools/node_modules/.bin/ares-package" "$APP_DIR" "$@" -o "$BUILD" >/dev/null
IPK="$(ls "$BUILD/${APP_ID}"_*.ipk)"
NAME="$(basename "$IPK")"
REMOTE="/media/developer/temp/$NAME"

"${SSH[@]}" "cat > $REMOTE" < "$IPK"

# On webOS 1.4, luna-send's "-n <count>" mode prints nothing; stream with "-i" and stop
# once the install service reports a final state.
"${SSH[@]}" "LOG=/media/developer/temp/install.log
  luna-send-pub -i -f luna://com.webos.appInstallService/dev/install \
    '{\"id\":\"com.ares.defaultName\",\"ipkUrl\":\"$REMOTE\",\"subscribe\":true}' > \$LOG 2>&1 &
  PID=\$!
  i=0
  while [ \$i -lt 60 ]; do
    grep -qE '\"state\": \"(installed|install failed)' \$LOG && break
    grep -q 'errorText' \$LOG && break
    sleep 1; i=\$((i + 1))
  done
  kill \$PID 2>/dev/null
  grep -oE '\"(state|errorText)\": \"[^\"]+\"' \$LOG | tail -1
  rm -f \$LOG $REMOTE"

# Launch the app over SSAP with the same client the service uses (any recent Node.js).
# A running app keeps its old page, even hidden, and a launch only brings it back to the
# front. So close it first, wait until it is gone, then launch the new version.
node -e '
var TVClient = require(process.argv[1] + "/services/home/ssap.js").TVClient;
var tv = new TVClient(process.argv[2], process.argv[1] + "/.tv_key");
var appId = process.argv[3];
function launch() {
  tv.request("ssap://system.launcher/launch", { id: appId }, function (err) {
    if (err) { console.error("launch failed: " + err.message); process.exit(1); }
    process.exit(0);
  });
}
tv.closeApp(appId, function () {
  (function wait(n) {
    tv.request("ssap://com.webos.applicationManager/getForegroundAppInfo", null, function (err, fg) {
      if (!err && fg.appId === appId && n < 10) return setTimeout(function () { wait(n + 1); }, 1000);
      setTimeout(launch, 5000);
    });
  })(0);
});
' "$ROOT" "$TV_IP" "$APP_ID"
echo "deployed and launched $APP_ID"
