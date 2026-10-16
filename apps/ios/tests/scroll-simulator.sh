#!/bin/bash
set -euo pipefail

# Run after building/installing the Debug app. This fixture never contacts
# the backend or modifies the signed-in user's conversations.
device=${1:-booted}
launch=$(xcrun simctl launch --terminate-running-process "$device" ai.nuphos.ios -scroll-regression)
pid=${launch##*: }
for attempt in {1..60}; do
  logs=$(xcrun simctl spawn "$device" log show --last 2m --style compact \
    --predicate "processID == $pid AND eventMessage CONTAINS \"scroll_regression\"" 2>/dev/null)
  if [[ "$logs" == *"name=suite_complete"* ]]; then
    printf '%s\n' "$logs"
    for name in open_every_frame open_stable sent_transition send_every_frame send_stable stream_preserves_question unchanged_refresh latest_button async_card_layout step_anchor pinned_stream_bottom pinned_stream_up; do
      if ! printf '%s\n' "$logs" | grep -q "name=$name passed=true"; then
        echo "FAIL: $name" >&2
        exit 1
      fi
    done
    exit 0
  fi
  sleep 1
done
echo "Timed out waiting for scroll regression results (PID $pid)" >&2
exit 1
