#!/usr/bin/env bash
set -euo pipefail
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
plan_id=${1:?usage: set-cost.sh PLAN_ID SUMMARY [ONE_TIME] [MONTHLY] [SAVINGS]}
summary=${2:?usage: set-cost.sh PLAN_ID SUMMARY [ONE_TIME] [MONTHLY] [SAVINGS]}
one_time=${3-}
monthly=${4-}
savings=${5-}
payload=$(jq -cn --arg costSummary "$summary" --arg costOneTime "$one_time" \
  --arg costMonthly "$monthly" --arg costSavings "$savings" \
  '{costSummary:$costSummary}
   + (if $costOneTime == "" then {} else {costOneTime:$costOneTime} end)
   + (if $costMonthly == "" then {} else {costMonthly:$costMonthly} end)
   + (if $costSavings == "" then {} else {costSavings:$costSavings} end)')
exec bash "$script_dir/_request.sh" PATCH "/$plan_id" "$payload"
