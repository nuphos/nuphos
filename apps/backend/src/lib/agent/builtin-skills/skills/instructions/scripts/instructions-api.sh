#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 2 || $# -gt 4 ]]; then
  printf 'usage: instructions-api.sh TEAM_ID METHOD [INSTRUCTION_ID] [JSON_OR_@FILE]\n' >&2
  exit 2
fi

team_id=$1
method=$2
resource=${3-}
body=${4-}
if [[ -n "$resource" && "$resource" != /* ]]; then
  resource="/$resource"
fi

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
request="$script_dir/../../_runtime/scripts/nuphos-api.sh"
args=("$method" "/teams/$team_id/instructions$resource")
[[ -z "$body" ]] || args+=("$body")
exec "$request" "${args[@]}"
