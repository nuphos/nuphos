#!/usr/bin/env bash
# Before/after evidence for an iOS UI test, read from the result bundles rather than exit codes.
#
#   bash apps/ios/tests/ui-evidence.sh <before-checkout> <after-checkout> <Class/testName> [xcodebuild args...]
#
# Runs `xcodebuild test` in each checkout with the given arguments (such as -destination and
# -only-testing), writes a per-test table to $GITHUB_STEP_SUMMARY (or stdout), and keeps
# before.xcresult and after.xcresult in $UI_EVIDENCE_OUT (default ./ui-evidence) for upload.
# Exits non-zero unless every test passes after the change and the named test fails before it
# on an assertion, not on a build or launch error. Copy a new test file into the before
# checkout first.
set -euo pipefail
[ $# -ge 3 ] || { sed -n 2,11p "$0"; exit 2; }
before=$(cd "$1" && pwd) after=$(cd "$2" && pwd) new=$3; shift 3
out=${UI_EVIDENCE_OUT:-$PWD/ui-evidence}
rm -rf "$out"; mkdir -p "$out"
derived=$(mktemp -d)
for side in before after; do
  dir=$before; [ "$side" = after ] && dir=$after
  # Failing tests make xcodebuild exit non-zero; the verdict below comes from the result bundle.
  status=0
  (cd "$dir/apps/ios" && xcodebuild test -project nuphos-ios.xcodeproj -scheme nuphos-ios -parallel-testing-enabled NO \
    -derivedDataPath "$derived/$side" -resultBundlePath "$out/$side.xcresult" CODE_SIGNING_ALLOWED=NO "$@") \
    > "$out/$side.log" 2>&1 || status=$?
  echo "$side: xcodebuild exited $status"
  if [ -d "$out/$side.xcresult" ]; then
    xcrun xcresulttool get test-results tests --path "$out/$side.xcresult" > "$out/$side.json"
  else
    echo '{}' > "$out/$side.json"; tail -40 "$out/$side.log"
  fi
done
python3 -I - "$out" "$new" <<'EOF'
import json, os, re, sys
out, new = sys.argv[1], sys.argv[2].removesuffix("()")
def cases(side):
    found = {}
    def walk(node):
        if node.get("nodeType") == "Test Case":
            name = node.get("nodeIdentifier", node.get("name", "")).removesuffix("()")
            failures = [c.get("name", "") for c in node.get("children", []) if c.get("nodeType") == "Failure Message"]
            found[name] = (node.get("result", "?"), failures)
        for child in node.get("children", []): walk(child)
    for node in json.load(open(f"{out}/{side}.json")).get("testNodes", []): walk(node)
    return found
before, after = cases("before"), cases("after")
def cell(result):
    if result is None: return "not run"
    state, failures = result
    return state + (": " + failures[0][:120].replace("|", "/") if failures else "")
rows = ["| Test | Before | After |", "|---|---|---|"]
rows += [f"| `{n}`{' (new)' if n == new else ''} | {cell(before.get(n))} | {cell(after.get(n))} |" for n in sorted(set(before) | set(after))]
problems = []
if not after: problems.append("no test results after the change")
problems += [f"`{n}` is {r[0]} after the change" for n, r in after.items() if r[0] not in ("Passed", "Skipped")]
if after.get(new, ("",))[0] != "Passed": problems.append(f"`{new}` did not pass after the change")
state, failures = before.get(new, ("not run", []))
if state != "Failed": problems.append(f"`{new}` is {state} before the change, not Failed")
elif not any(re.search(r"\.swift:\d+", f) for f in failures): problems.append(f"`{new}` failed before the change without an assertion (build or launch error)")
verdict = "**Evidence holds:** the new test fails before the change on an assertion and every test passes after it." if not problems \
    else "**Evidence does not hold:**\n" + "\n".join(f"- {p}" for p in problems)
report = "\n".join(rows + ["", verdict, ""])
print(report)
summary = os.environ.get("GITHUB_STEP_SUMMARY")
if summary: open(summary, "a").write(report + "\n")
sys.exit(1 if problems else 0)
EOF
