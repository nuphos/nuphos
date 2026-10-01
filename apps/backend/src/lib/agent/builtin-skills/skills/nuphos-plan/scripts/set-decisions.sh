#!/usr/bin/env bash
set -euo pipefail
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
plan_id=${1:?usage: set-decisions.sh PLAN_ID DECISIONS_JSON}
decisions=${2:?usage: set-decisions.sh PLAN_ID DECISIONS_JSON}
if ! jq -e '
  type == "array" and
  all(.[]; type == "object" and
    (.label | type == "string" and length > 0) and
    (.value | type == "string" and length > 0))
' >/dev/null 2>&1 <<<"$decisions"; then
  printf '%s\n' \
    'invalid decisions JSON: expected [{"label":"Decision name","value":"Chosen value"}]' >&2
  exit 2
fi
payload=$(jq -cn --argjson decisions "$decisions" '{decisions:$decisions}')
exec bash "$script_dir/_request.sh" PATCH "/$plan_id" "$payload"
