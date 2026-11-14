#!/bin/bash
# Scratch only: builds the PR head at ./pr with one shots test, then screenshots the account
# setting and the offline / back-online banners (the payloads the backend sends, via simctl push).
set -uo pipefail
out=$1; mkdir -p "$out/iphone"
root=$PWD
cp scratch-computer-alerts/ShotsUITests.swift pr/apps/ios/UITests/ComputerAlertsShotsUITests.swift
cd pr/apps/ios
defaults write com.apple.iphonesimulator ConnectHardwareKeyboard -bool false
dd="$RUNNER_TEMP/dd"
xcodebuild build-for-testing -project nuphos-ios.xcodeproj -scheme nuphos-ios -configuration Debug \
  -destination 'generic/platform=iOS Simulator' -derivedDataPath "$dd" \
  CODE_SIGN_STYLE=Manual CODE_SIGN_IDENTITY=- DEVELOPMENT_TEAM= PROVISIONING_PROFILE_SPECIFIER= -quiet 2>&1 | tail -40 | tee "$out/build.txt"
types=$(xcrun simctl list devicetypes -j)
type=$(python3 -c "import json,sys; print([d['identifier'] for d in json.loads(sys.argv[1])['devicetypes'] if d['name']=='iPhone 17 Pro'][-1])" "$types")
u=$(xcrun simctl create phone "$type"); xcrun simctl boot "$u"; xcrun simctl bootstatus "$u" -b >/dev/null
xcrun simctl ui "$u" appearance light
xcrun simctl status_bar "$u" override --time 9:41 --batteryState charged --batteryLevel 100 --cellularBars 4 --wifiBars 3
d="$out/iphone"
( while :; do for req in "$d"/*.req; do [ -e "$req" ] || continue; n=$(basename "$req" .req)
    case $n in
      2-offline) xcrun simctl push "$u" ai.nuphos.ios "$root/scratch-computer-alerts/offline.apns"; sleep 2 ;;
      3-online) xcrun simctl push "$u" ai.nuphos.ios "$root/scratch-computer-alerts/online.apns"; sleep 2 ;;
    esac
    xcrun simctl io "$u" screenshot "$d/$n.png"; rm -f "$req"; done; sleep 0.3; done ) &
rig=$!
TEST_RUNNER_NUPHOS_SHOTS="$d" xcodebuild test-without-building -project nuphos-ios.xcodeproj -scheme nuphos-ios \
  -destination "id=$u" -derivedDataPath "$dd" -only-testing:nuphos-iosUITests/ComputerAlertsShotsUITests \
  -parallel-testing-enabled NO 2>&1 | grep -vE "IDESchemeAction|IDELaunchParameters" | tail -200 | tee "$d/tests.txt"
kill $rig
xcrun simctl shutdown "$u"
ls -laR "$out"
