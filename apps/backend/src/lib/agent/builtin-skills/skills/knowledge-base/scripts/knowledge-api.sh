#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 3 ]]; then
  printf 'usage: knowledge-api.sh TEAM_ID search|issues|contributions JSON_OR_@FILE\n' >&2
  exit 2
fi

team_id=$1
action=$2
body=$3
case "$action" in
  search|issues|contributions) ;;
  *) printf 'unknown knowledge action: %s\n' "$action" >&2; exit 2 ;;
esac

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
request="$script_dir/../../_runtime/scripts/nuphos-api.sh"
exec "$request" POST "/teams/$team_id/knowledge/$action" "$body"
