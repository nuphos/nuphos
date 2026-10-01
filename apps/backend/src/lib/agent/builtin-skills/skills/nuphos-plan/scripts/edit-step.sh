#!/usr/bin/env bash
set -euo pipefail
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
plan_id=${1:?usage: edit-step.sh PLAN_ID STEP_INDEX STEP_JSON}
step_idx=${2:?usage: edit-step.sh PLAN_ID STEP_INDEX STEP_JSON}
step=${3:?usage: edit-step.sh PLAN_ID STEP_INDEX STEP_JSON}
payload=$(jq -cn --argjson stepIdx "$step_idx" --argjson step "$step" \
  '{editStep:{stepIdx:$stepIdx,step:$step}}')
exec bash "$script_dir/_request.sh" PATCH "/$plan_id" "$payload"
