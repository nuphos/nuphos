#!/usr/bin/env bash
set -euo pipefail
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
plan_id=${1:?usage: remove-step.sh PLAN_ID STEP_INDEX}
step_idx=${2:?usage: remove-step.sh PLAN_ID STEP_INDEX}
payload=$(jq -cn --argjson stepIdx "$step_idx" '{removeStep:{stepIdx:$stepIdx}}')
exec bash "$script_dir/_request.sh" PATCH "/$plan_id" "$payload"
