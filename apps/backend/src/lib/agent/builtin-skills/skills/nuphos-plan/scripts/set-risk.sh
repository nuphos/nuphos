#!/usr/bin/env bash
set -euo pipefail
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
plan_id=${1:?usage: set-risk.sh PLAN_ID WORST_CASE MITIGATIONS_JSON}
worst_case=${2:?usage: set-risk.sh PLAN_ID WORST_CASE MITIGATIONS_JSON}
mitigations=${3:?usage: set-risk.sh PLAN_ID WORST_CASE MITIGATIONS_JSON}
payload=$(jq -cn --arg riskWorstCase "$worst_case" --argjson riskMitigations "$mitigations" \
  '{riskWorstCase:$riskWorstCase,riskMitigations:$riskMitigations}')
exec bash "$script_dir/_request.sh" PATCH "/$plan_id" "$payload"
