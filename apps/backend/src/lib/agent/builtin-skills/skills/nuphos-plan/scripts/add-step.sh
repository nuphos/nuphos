#!/usr/bin/env bash
set -euo pipefail
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
plan_id=${1:?usage: add-step.sh PLAN_ID STEP_JSON [INSERT_AT]}
step=${2:?usage: add-step.sh PLAN_ID STEP_JSON [INSERT_AT]}
insert_at=${3-}
if [[ -n "$insert_at" ]]; then
  payload=$(jq -cn --argjson step "$step" --argjson insertAt "$insert_at" \
    '{appendStep:$step,insertAt:$insertAt}')
else
  payload=$(jq -cn --argjson step "$step" '{appendStep:$step}')
fi
exec bash "$script_dir/_request.sh" PATCH "/$plan_id" "$payload"
