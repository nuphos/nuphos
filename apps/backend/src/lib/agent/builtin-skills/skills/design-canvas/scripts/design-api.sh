#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 2 || $# -gt 4 ]]; then
  printf 'usage: design-api.sh TEAM_ID METHOD [DESIGN_ID[/ops]] [JSON_OR_@FILE]\n' >&2
  exit 2
fi

team_id=$1
method=$2
design_path=${3-}
body=${4-}
if [[ -n "$design_path" && ! "$design_path" =~ ^[0-9a-f]{24}(/ops)?$ ]]; then
  printf 'DESIGN_ID must be a 24-hex id, optionally followed by /ops\n' >&2
  exit 2
fi
path="/teams/$team_id/designs"
[[ -z "$design_path" ]] || path="$path/$design_path"

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
request="$script_dir/../../_runtime/scripts/nuphos-api.sh"
args=("$method" "$path")
[[ -z "$body" ]] || args+=("$body")
exec "$request" "${args[@]}"
