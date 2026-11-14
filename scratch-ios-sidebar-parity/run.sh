#!/bin/bash
# Scratch only: builds the PR head at ./pr for testing once, then runs the Bots/Tasks list UI tests
# on each device in light mode, keeping every screenshot they take.
set -uo pipefail
out=$1; mkdir -p "$out"
cd pr/apps/ios
dd="$RUNNER_TEMP/dd"
xcodebuild build-for-testing -project nuphos-ios.xcodeproj -scheme nuphos-ios -configuration Debug \
  -destination 'generic/platform=iOS Simulator' -derivedDataPath "$dd" \
  CODE_SIGN_STYLE=Manual CODE_SIGN_IDENTITY=- DEVELOPMENT_TEAM= PROVISIONING_PROFILE_SPECIFIER= -quiet 2>&1 | tail -60 | tee "$out/build.txt"
types=$(xcrun simctl list devicetypes -j)
type_of() { python3 -c "import json,re,sys; t=[d['identifier'] for d in json.loads(sys.argv[1])['devicetypes'] if re.fullmatch(sys.argv[2], d['name'])]; print(t[-1])" "$types" "$1"; }
boot() { local u; u=$(xcrun simctl create "$1" "$2"); xcrun simctl boot "$u"; xcrun simctl bootstatus "$u" -b >/dev/null; xcrun simctl ui "$u" appearance light; echo "$u"; }
status=0
only=""
for c in BotsAndTasksListUITests PinsTasksLayoutArchiveUITests; do [ -f "UITests/$c.swift" ] && only="$only -only-testing:nuphos-iosUITests/$c"; done
run() { # name udid
  local name=$1 udid=$2
  mkdir -p "$out/$name"
  TEST_RUNNER_NUPHOS_SHOTS="$out/$name" xcodebuild test-without-building -project nuphos-ios.xcodeproj -scheme nuphos-ios \
    -destination "id=$udid" -derivedDataPath "$dd" $only -parallel-testing-enabled NO \
    -resultBundlePath "$RUNNER_TEMP/$name.xcresult" 2>&1 | grep -vE "IDESchemeAction|IDELaunchParameters" | tail -300 | tee "$out/$name/tests.txt"
  [ "${PIPESTATUS[0]}" -eq 0 ] || status=1
  xcrun simctl shutdown "$udid"
}
run iphone "$(boot iphone "$(type_of 'iPhone 17 Pro')")"
run ipad "$(boot ipad "$(type_of 'iPad Pro 13-inch.*')")"
ls -laR "$out"
exit $status
