#!/bin/bash
set -euo pipefail

# Only the open chat polls. Uses the offline chats fixture, so it never
# contacts the backend. Run after installing a Debug build:
#
#   bash tests/channel-polling-simulator.sh [device]
#
# The app opens chat A from its link, then chat B, then goes back to the list.
# Afterwards neither chat may be requested. Before the fix, the collapsed split
# view kept the last chat's view, and with it a session that polled forever.
device=${1:-booted}
team=64b5f1c2e4b0a1d2c3e4f5a6
fixture="$(cd "$(dirname "$0")" && pwd)/fixtures/channel-responses.json"

# A first launch remembers that there are chats, so the next one starts on
# the Chats tab; switching to it on its own would close the chat opened here.
SIMCTL_CHILD_NUPHOS_PREVIEW_RESPONSES="$fixture" \
  xcrun simctl launch --terminate-running-process "$device" ai.nuphos.ios -preview-home -preview-no-push >/dev/null
sleep 5

launch=$(SIMCTL_CHILD_NUPHOS_PREVIEW_RESPONSES="$fixture" \
  xcrun simctl launch --terminate-running-process "$device" ai.nuphos.ios \
  -preview-home -preview-no-push -open-links \
  "https://nuphos.ai/teams/$team/agent/chat-release" \
  "https://nuphos.ai/teams/$team/agent/chat-design" \
  "https://nuphos.ai/agent")
pid=${launch##*: }

requests() {
  xcrun simctl spawn "$device" log show --last "$1" --style compact \
    --predicate "processID == $pid AND category == \"preview\" AND eventMessage ENDSWITH \"GET /agent/conversations/$2\"" 2>/dev/null |
    grep -c "preview_request" || true
}

# Three links two seconds apart, then time for any chat still polling (every
# four seconds) to show up in a ten-second window.
sleep 20
if [[ $(requests 30s chat-design) -eq 0 ]]; then
  echo "FAIL: chat B never loaded, so this run proves nothing" >&2
  exit 1
fi
for chat in chat-release chat-design; do
  if [[ $(requests 10s "$chat") -gt 0 ]]; then
    echo "FAIL: $chat is still polling after going back to the list" >&2
    exit 1
  fi
done
echo "Only the open chat polls: passed"
