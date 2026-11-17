#!/usr/bin/env bash
# One-off: runs 0.200.0 from a folder, with 0.200.1 on a local feed, and watches what it does.
set -uo pipefail
T="$RUNNER_TEMP"; E="$T/evidence"; mkdir -p "$E"
DATA="$HOME/Library/Application Support/Nuphos"
SHIPIT="$HOME/Library/Caches/ai.nuphos.desktop.ShipIt"
APP="$T/run/Nuphos.app"
BIN="$APP/Contents/MacOS/Nuphos"
log() { echo "$(date -u +%H:%M:%S) $*" | tee -a "$E/timeline.txt"; }
version() { /usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$APP/Contents/Info.plist" 2>/dev/null; }
pid() { pgrep -f "$BIN" | head -1; }
idle() { ioreg -c IOHIDSystem | awk '/HIDIdleTime/ {print int($NF/1000000000); exit}'; }
staged() { ls -d "$SHIPIT"/update.*/*.app 2>/dev/null | head -1; }

(cd "$T/build-0.200.1" && python3 -m http.server 8765 --bind 127.0.0.1 > "$E/feed.log" 2>&1 &)
sleep 2

fresh() { # fresh <name>: 0.200.0 in place, nothing staged, no preference unless written after
  pkill -9 -f "$BIN" 2>/dev/null; sleep 2
  rm -rf "$T/run" "$SHIPIT" "$DATA"; mkdir -p "$T/run"
  ditto -x -k "$T/build-0.200.0/Nuphos-0.200.0-$ARCH.zip" "$T/run"
  log "[$1] installed $(version) at $APP"
}
launch() { # launch <name>
  NUPHOS_AUTO_UPDATE_IDLE_SECONDS=30 ELECTRON_ENABLE_LOGGING=1 nohup "$BIN" > "$E/app-$1.log" 2>&1 &
  sleep 8
  log "[$1] launched pid $(pid), running $(version), system idle $(idle)s, preference file: $(cat "$DATA/auto-update.json" 2>/dev/null || echo none)"
}

status=0

# 1. Nobody ever chose: the update installs by itself.
fresh default; launch default
first=$(pid); seen=""
for i in $(seq 1 96); do
  sleep 5
  if [ -z "$seen" ] && [ -n "$(staged)" ]; then seen=1; log "[default] update staged by the OS: $(staged)"; fi
  if [ "$(version)" = 0.200.1 ] && [ -n "$(pid)" ] && [ "$(pid)" != "$first" ]; then break; fi
done
log "[default] now running $(version), pid $(pid) (was $first), preference file: $(cat "$DATA/auto-update.json" 2>/dev/null || echo none)"
if [ "$(version)" = 0.200.1 ] && [ -n "$(pid)" ] && [ "$(pid)" != "$first" ]; then
  log "[default] PASS: 0.200.0 restarted into 0.200.1 by itself, nobody quit it"
else
  log "[default] FAIL: still $(version)"; status=1
fi
cp "$SHIPIT"/ShipIt_stderr.log "$E/shipit-default.log" 2>/dev/null

# 2. The owner turned it off: the update is staged and stays staged.
fresh off; mkdir -p "$DATA"; echo '{"enabled":false}' > "$DATA/auto-update.json"; launch off
first=$(pid); seen=""
for i in $(seq 1 60); do
  sleep 5
  if [ -n "$(staged)" ]; then seen=1; log "[off] update staged by the OS: $(staged)"; break; fi
done
if [ -z "$seen" ]; then log "[off] FAIL: the update was never staged, so this run shows nothing"; status=1; fi
log "[off] waiting 180 s: three checks, each with the computer idle for more than 30 s"
sleep 180
log "[off] now running $(version), pid $(pid) (was $first), system idle $(idle)s"
if [ "$(version)" = 0.200.0 ] && [ "$(pid)" = "$first" ]; then
  log "[off] PASS: still 0.200.0, same process"
else
  log "[off] FAIL: it changed"; status=1
fi
pkill -9 -f "$BIN" 2>/dev/null
grep -c "GET" "$E/feed.log" | sed 's/^/feed requests: /' | tee -a "$E/timeline.txt"
echo; echo "===== timeline"; cat "$E/timeline.txt"
exit $status
