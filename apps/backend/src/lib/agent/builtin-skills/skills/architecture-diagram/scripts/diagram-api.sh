#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 2 || $# -gt 4 ]]; then
  printf 'usage: diagram-api.sh TEAM_ID METHOD [DIAGRAM_ID] [JSON_OR_@FILE]\n' >&2
  exit 2
fi

team_id=$1
method=$2
diagram_id=${3-}
body=${4-}
path="/teams/$team_id/architecture-diagrams"
[[ -z "$diagram_id" ]] || path="$path/$diagram_id"

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
request="$script_dir/../../_runtime/scripts/nuphos-api.sh"
args=("$method" "$path")
[[ -z "$body" ]] || args+=("$body")
exec "$request" "${args[@]}"
