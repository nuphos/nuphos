#!/bin/bash
set -euo pipefail

# Only the open chat polls, and only while the app is active. Uses the offline
# chats fixture, so it never contacts the backend. Run after installing a Debug
# build:
#
#   bash tests/channel-polling-simulator.sh [device]
#
# 1. Opens chat A, then chat B, then the list: neither chat may be requested.
#    Before the fix, the collapsed split view kept the last chat's view, and
#    with it a session that polled forever.
# 2. Opens chat B: it polls. In the background it stops; back in the
#    foreground it polls again.
device=${1:-booted}
team=64b5f1c2e4b0a1d2c3e4f5a6
fixture="$(cd "$(dirname "$0")" && pwd)/fixtures/channel-responses.json"
chat_a="https://nuphos.ai/teams/$team/agent/chat-release"
chat_b="https://nuphos.ai/teams/$team/agent/chat-design"

launch() {
  local out
  out=$(SIMCTL_CHILD_NUPHOS_PREVIEW_RESPONSES="$fixture" \
    xcrun simctl launch --terminate-running-process "$device" ai.nuphos.ios -preview-home -preview-no-push "$@")
  pid=${out##*: }
}

# Requests for a chat in the last $1, by the running app.
requests() {
  xcrun simctl spawn "$device" log show --last "$1" --style compact \
    --predicate "processID == $pid AND category == \"preview\" AND eventMessage ENDSWITH \"GET /agent/conversations/$2\"" 2>/dev/null |
    grep -c "preview_request" || true
}

fail() { echo "FAIL: $*" >&2; exit 1; }

# A first launch remembers that there are chats, so the next one starts on
# the Chats tab; switching to it on its own would close the chat opened here.
launch
sleep 5

# Links open two seconds apart; a chat polls every four seconds.
launch -open-links "$chat_a" "$chat_b" "https://nuphos.ai/agent"
sleep 20
[[ $(requests 30s chat-design) -gt 0 ]] || fail "chat B never loaded, so this run proves nothing"
for chat in chat-release chat-design; do
  [[ $(requests 10s "$chat") -eq 0 ]] || fail "$chat is still polling after going back to the list"
done

launch -open-links "$chat_b"
sleep 12
[[ $(requests 9s chat-design) -gt 0 ]] || fail "the open chat is not polling"
xcrun simctl launch "$device" com.apple.Preferences >/dev/null
sleep 12
[[ $(requests 9s chat-design) -eq 0 ]] || fail "the open chat polls in the background"
xcrun simctl launch "$device" ai.nuphos.ios >/dev/null
sleep 10
[[ $(requests 9s chat-design) -gt 0 ]] || fail "the open chat did not poll again in the foreground"
echo "Only the open chat polls, and only while active: passed"
