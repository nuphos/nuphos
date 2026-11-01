#!/bin/bash
# usage: shot1288.sh <before|after>
set -euo pipefail
which=$1; root=/tmp/pr1288; dev="pr1288-$which"
udid=$(xcrun simctl list devices | grep "$dev (" | grep -oE '[0-9A-F-]{36}' | head -1 || true)
[ -n "$udid" ] || udid=$(xcrun simctl create "$dev" "iPhone 17 Pro" com.apple.CoreSimulator.SimRuntime.iOS-26-3)
xcrun simctl boot "$udid" 2>/dev/null || true
xcrun simctl ui "$udid" appearance light
cd "$root/$which/apps/ios"
xcodebuild -project nuphos-ios.xcodeproj -scheme nuphos-ios -configuration Debug -destination "id=$udid" -derivedDataPath "$root/dd-$which" CODE_SIGNING_ALLOWED=NO build -quiet > "$root/build-$which.log" 2>&1
app=$(find "$root/dd-$which/Build/Products/Debug-iphonesimulator" -maxdepth 1 -name '*.app' | head -1)
xcrun simctl install "$udid" "$app"
SIMCTL_CHILD_NUPHOS_PREVIEW_RESPONSES="$root/fixture.json" xcrun simctl launch --terminate-running-process "$udid" ai.nuphos.ios -preview-home -preview-no-push -open-links "https://nuphos.ai/teams/64b5f1c2e4b0a1d2c3e4f5a6/agent/push-a"
sleep 12
xcrun simctl io "$udid" screenshot "$root/$which.png"
echo "DONE $which"
