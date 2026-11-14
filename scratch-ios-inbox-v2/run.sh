#!/bin/bash
# Scratch only: builds the PR head at ./pr for testing once, then runs the Inbox UI tests on each device,
# keeping every screenshot they take.
set -uo pipefail
out=$1; mkdir -p "$out"
root=$PWD
cd pr/apps/ios
dd="$RUNNER_TEMP/dd"
R="$RUNNER_TEMP/sill/Tests/duorig/run.sh"
xcodebuild build-for-testing -project nuphos-ios.xcodeproj -scheme nuphos-ios -configuration Debug \
  -destination 'generic/platform=iOS Simulator' -derivedDataPath "$dd" \
  CODE_SIGN_STYLE=Manual CODE_SIGN_IDENTITY=- DEVELOPMENT_TEAM= PROVISIONING_PROFILE_SPECIFIER= -quiet 2>&1 | tail -40 | tee "$out/build.txt"
types=$(xcrun simctl list devicetypes -j)
type_of() { python3 -c "import json,re,sys; t=[d['identifier'] for d in json.loads(sys.argv[1])['devicetypes'] if re.fullmatch(sys.argv[2], d['name'])]; print(t[-1])" "$types" "$1"; }
boot() { local u; u=$(xcrun simctl create "$1" "$2"); xcrun simctl boot "$u"; xcrun simctl bootstatus "$u" -b >/dev/null; xcrun simctl ui "$u" appearance light; echo "$u"; }
run() { # name udid [only-testing...]
  local name=$1 udid=$2; shift 2
  mkdir -p "$out/$name"
  local only=(); for t in "$@"; do only+=(-only-testing:"nuphos-iosUITests/InboxUITests/$t"); done
  [ ${#only[@]} -eq 0 ] && only=(-only-testing:nuphos-iosUITests/InboxUITests)
  TEST_RUNNER_NUPHOS_SHOTS="$out/$name" xcodebuild test-without-building -project nuphos-ios.xcodeproj -scheme nuphos-ios \
    -destination "id=$udid" -derivedDataPath "$dd" "${only[@]}" -parallel-testing-enabled NO \
    -resultBundlePath "$RUNNER_TEMP/$name.xcresult" 2>&1 | grep -E "error|failed|passed|Test Case|XCTAssert" | tail -60 | tee "$out/$name/tests.txt"
}
phone=$(boot phone "$(type_of 'iPhone 17 Pro')")
run iphone "$phone"
xcrun simctl shutdown "$phone"

ipad=$(boot ipad "$(type_of 'iPad Air 11-inch.*|iPad Pro 11-inch.*|iPad \(A16\)')")
run ipad "$ipad" testAnswersAQuestionFromTheInbox testAnswersInWordsWithOther
xcrun simctl shutdown "$ipad"

duo=$(boot duo "$(type_of 'iPhone Duo')")
"$R" "$duo" pose flat-landscape
run duo "$duo" testAnswersAQuestionFromTheInbox testAnswersInWordsWithOther
"$R" "$duo" shot flat-landscape "$out/duo/rig-after.png"
xcrun simctl shutdown "$duo"
ls -laR "$out"
