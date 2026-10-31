#!/bin/bash
# Scratch only: screenshots the chat title on every layout, for the before and after builds.
# usage: shoot.sh <out-dir>   (needs $RUNNER_TEMP/dd-before, $RUNNER_TEMP/dd-after and duorig built)
set -uo pipefail
out=$1; mkdir -p "$out"
here=$(cd "$(dirname "$0")" && pwd)
fix=$here/../apps/ios/tests/fixtures/push-responses.json
python3 - "$fix" "$out/long.json" <<'PY'
import sys
s = open(sys.argv[1]).read().replace("Preview push-a", "Why the M5 shows a Desktop button but the M1 does not, on every device")
open(sys.argv[2], "w").write(s)
PY
R="$RUNNER_TEMP/sill/Tests/duorig/run.sh"
types=$(xcrun simctl list devicetypes -j)
type_of() { python3 -c "import json,sys; t=[d['identifier'] for d in json.loads(sys.argv[1])['devicetypes'] if d['name'].startswith(sys.argv[2])]; print(t[-1])" "$types" "$1"; }

launch() { # udid build title
  local app; app=$(find "$RUNNER_TEMP/dd-$2/Build/Products" -name 'nuphos-ios.app' -path '*iphonesimulator*' | head -1)
  xcrun simctl terminate "$1" ai.nuphos.ios 2>/dev/null || true
  xcrun simctl uninstall "$1" ai.nuphos.ios 2>/dev/null || true
  xcrun simctl install "$1" "$app"
  local f="$fix"; [ "$3" = long ] && f="$out/long.json"
  SIMCTL_CHILD_NUPHOS_PREVIEW_RESPONSES="$f" xcrun simctl launch "$1" ai.nuphos.ios -preview-home -preview-no-push -open-first-chat >/dev/null
  sleep 12
}

boot() { # name type
  local u; u=$(xcrun simctl create "$1" "$2"); xcrun simctl boot "$u"; xcrun simctl bootstatus "$u" -b >/dev/null
  xcrun simctl ui "$u" appearance light; echo "$u"
}

for dev in "iPhone 17 Pro" "iPad mini"; do
  u=$(boot "$dev" "$(type_of "$dev")")
  for b in before after; do for t in short long; do
    launch "$u" $b $t
    xcrun simctl io "$u" screenshot "$out/${dev// /-}-$t-$b.png" >/dev/null
  done; done
  xcrun simctl shutdown "$u"
done

duo=$(boot duo "$(type_of "iPhone Duo")")
for pose in closed-upright flat-portrait flat-landscape book laptop; do
  "$R" "$duo" pose "$pose"; sleep 2
  for b in before after; do for t in short long; do
    launch "$duo" $b $t
    "$R" "$duo" shot "$pose" "$out/duo-$pose-$t-$b.png" || echo "shot failed: $pose $t $b"
  done; done
done
ls -la "$out"
