#!/bin/bash
set -euo pipefail

# Reopening a chat from a session link must load it. Uses the offline push
# fixture, so it never contacts the backend. Run after installing a Debug build:
#
#   bash tests/session-link-simulator.sh [device]
#
# The app opens chat A from its link, goes back to the list from a link, then
# opens chat A's link again. The second open must request A again; before the
# fix the chat kept a session that never loaded and spun forever.
device=${1:-booted}
team=64b5f1c2e4b0a1d2c3e4f5a6
chat="https://nuphos.ai/teams/$team/agent/push-a"
fixture="$(cd "$(dirname "$0")" && pwd)/fixtures/push-responses.json"

launch=$(SIMCTL_CHILD_NUPHOS_PREVIEW_RESPONSES="$fixture" \
  xcrun simctl launch --terminate-running-process "$device" ai.nuphos.ios \
  -preview-home -preview-no-push -open-links "$chat" "https://nuphos.ai/agent" "$chat")
pid=${launch##*: }

# Three links two seconds apart, then time for the last chat to load. A loaded
# chat polls itself every three seconds, so a live chat A shows up in any
# six-second window; the stuck one never requested anything.
sleep 20
loads=$(xcrun simctl spawn "$device" log show --last 6s --style compact \
  --predicate "processID == $pid AND category == \"preview\" AND eventMessage ENDSWITH \"GET /agent/conversations/push-a\"" 2>/dev/null |
  grep -c "preview_request" || true)
if [[ $loads -eq 0 ]]; then
  echo "FAIL: chat A reopened from its link is not loading" >&2
  exit 1
fi
echo "Session link reopen passed"
