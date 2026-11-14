#!/bin/bash
# Scratch only: builds the PR head at ./pr for testing once, then runs the Inbox UI tests on each device,
# keeping every screenshot they take.
set -uo pipefail
out=$1; mkdir -p "$out"
root=$PWD
cd pr/apps/ios
python3 - UITests/InboxUITests.swift <<'PY'
import sys
p=sys.argv[1]; s=open(p).read()
old='        let screenshot = XCUIScreen.main.screenshot()\n'
new=old+"""        if let dir = ProcessInfo.processInfo.environment["NUPHOS_SHOTS"], ProcessInfo.processInfo.environment["NUPHOS_RIG"] == "1" {
            let req = URL(filePath: dir).appending(path: "\\(name).req")
            try? Data().write(to: req)
            for _ in 0..<60 where FileManager.default.fileExists(atPath: req.path) { Thread.sleep(forTimeInterval: 0.5) }
            return
        }
"""
assert old in s; s=s.replace(old,new,1)
old='        XCTAssertTrue(toast.waitForExistence(timeout: 5), "No toast saying what was answered")\n'
assert old in s
s=s.replace(old,'        if !toast.waitForExistence(timeout: 5) { print("TOAST-MISSING", Date(), app.debugDescription) }\n'+old,1)
open(p,'w').write(s)
PY
# Scratch only: Duo's rig photo takes ~5 s, longer than the 5 s hold, so stretch the hold to catch the toast.
sed -i '' 's/Task.sleep(for: .seconds(5))/Task.sleep(for: .seconds(20))/' nuphos-ios/Services/Chat/OpenQuestions.swift
sed -i '' 's/toast.waitForNonExistence(timeout: 10)/toast.waitForNonExistence(timeout: 30)/' UITests/InboxUITests.swift
grep -c "seconds(20)" nuphos-ios/Services/Chat/OpenQuestions.swift
# No hardware keyboard, as in the design: no focus ring on the selected row.
defaults write com.apple.iphonesimulator ConnectHardwareKeyboard -bool false
dd="$RUNNER_TEMP/dd"
R="$RUNNER_TEMP/sill/Tests/duorig/run.sh"
xcodebuild build-for-testing -project nuphos-ios.xcodeproj -scheme nuphos-ios -configuration Debug \
  -destination 'generic/platform=iOS Simulator' -derivedDataPath "$dd" \
  CODE_SIGN_STYLE=Manual CODE_SIGN_IDENTITY=- DEVELOPMENT_TEAM= PROVISIONING_PROFILE_SPECIFIER= -quiet 2>&1 | tail -40 | tee "$out/build.txt"
types=$(xcrun simctl list devicetypes -j)
type_of() { python3 -c "import json,re,sys; t=[d['identifier'] for d in json.loads(sys.argv[1])['devicetypes'] if re.fullmatch(sys.argv[2], d['name'])]; print(t[-1])" "$types" "$1"; }
boot() { local u; u=$(xcrun simctl create "$1" "$2"); xcrun simctl boot "$u"; xcrun simctl bootstatus "$u" -b >/dev/null; xcrun simctl ui "$u" appearance light
  # No "Speed up your typing" tip over the keyboard.
  for d in com.apple.Preferences com.apple.keyboard.preferences; do xcrun simctl spawn "$u" defaults write $d DidShowContinuousPathIntroduction -bool true; xcrun simctl spawn "$u" defaults write $d KeyboardContinuousPathEnabled -bool false; done
  echo "$u"; }
run() { # name udid [only-testing...]
  local name=$1 udid=$2; shift 2
  mkdir -p "$out/$name"
  local only=(); for t in "$@"; do only+=(-only-testing:"nuphos-iosUITests/InboxUITests/$t"); done
  [ ${#only[@]} -eq 0 ] && only=(-only-testing:nuphos-iosUITests/InboxUITests)
  TEST_RUNNER_NUPHOS_SHOTS="$out/$name" TEST_RUNNER_NUPHOS_RIG="${NUPHOS_RIG:-}" xcodebuild test-without-building -project nuphos-ios.xcodeproj -scheme nuphos-ios \
    -destination "id=$udid" -derivedDataPath "$dd" "${only[@]}" -parallel-testing-enabled NO \
    -resultBundlePath "$RUNNER_TEMP/$name.xcresult" 2>&1 | grep -vE "IDESchemeAction|IDELaunchParameters" | tail -400 | tee "$out/$name/tests.txt"
}
duo=$(boot duo "$(type_of 'iPhone Duo')")
"$R" "$duo" pose flat-landscape
mkdir -p "$out/duo"
( while :; do for req in "$out"/duo/*.req; do [ -e "$req" ] || continue; n=$(basename "$req" .req)
    sleep 1; "$R" "$duo" shot flat-landscape "$out/duo/$n.png"; rm -f "$req"; done; sleep 0.5; done ) &
rig=$!
NUPHOS_RIG=1 run duo "$duo" testAnswersAQuestionFromTheInbox testAnswersInWordsWithOther
kill $rig
xcrun simctl shutdown "$duo"
ls -laR "$out"
