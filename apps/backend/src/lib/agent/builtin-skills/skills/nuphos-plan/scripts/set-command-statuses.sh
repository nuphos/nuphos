#!/usr/bin/env bash
set -euo pipefail
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)

usage() {
  cat >&2 <<'EOF'
usage:
  set-command-statuses.sh PLAN_ID CHANGES_JSON
  set-command-statuses.sh PLAN_ID STEP_IDX JOB_IDX CMD_IDX STATUS

CHANGES_JSON example:
  [{"stepIdx":0,"jobIdx":0,"cmdIdx":0,"status":"running"}]

STATUS is one of: pending, running, done, failed
EOF
  exit 2
}

[[ $# -eq 2 || $# -eq 5 ]] || usage
plan_id=$1

if [[ $# -eq 5 ]]; then
  changes=$(jq -cn \
    --argjson stepIdx "$2" \
    --argjson jobIdx "$3" \
    --argjson cmdIdx "$4" \
    --arg status "$5" \
    '[{stepIdx:$stepIdx,jobIdx:$jobIdx,cmdIdx:$cmdIdx,status:$status}]') || usage
else
  changes=$2
fi

if ! jq -e '
  type == "array" and length > 0 and
  all(.[];
    type == "object" and
    (keys | sort) == ["cmdIdx", "jobIdx", "status", "stepIdx"] and
    (.stepIdx | type == "number" and floor == . and . >= 0) and
    (.jobIdx | type == "number" and floor == . and . >= 0) and
    (.cmdIdx | type == "number" and floor == . and . >= 0) and
    (.status == "pending" or .status == "running" or .status == "done" or .status == "failed")
  )
' >/dev/null 2>&1 <<<"$changes"; then
  cat >&2 <<'EOF'
invalid command status changes: expected a non-empty array of exactly
[{"stepIdx":0,"jobIdx":0,"cmdIdx":0,"status":"running"}]
STATUS must be pending, running, done, or failed.
EOF
  exit 2
fi

payload=$(jq -cn --argjson commandStatuses "$changes" '{commandStatuses:$commandStatuses}')
exec bash "$script_dir/_request.sh" PATCH "/$plan_id" "$payload"
