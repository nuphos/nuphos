#!/usr/bin/env bash
set -euo pipefail
if [ "$#" -ne 3 ] || ! [[ "$1" =~ ^[a-fA-F0-9]{24}$ && "$2" =~ ^[a-fA-F0-9]{24}$ && "$3" =~ ^TRELLO_[A-Z0-9_]+$ ]]; then
  echo 'Usage: composio.sh <teamId> <bindingId> <TRELLO_TOOL> < arguments.json' >&2
  exit 2
fi
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
source "$script_dir/../../_runtime/scripts/nuphos-token.sh"
auth_token="$(nuphos_token)"
base="${NUPHOS_BACKEND_URL:-${NUPHOS_API_URL:-https://api.nuphos.ai}}"
body=$(python3 -c 'import json, sys; print(json.dumps({"tool": sys.argv[1], "arguments": json.load(sys.stdin)}))' "$3")
# Server resolves the selected binding, account and authorizing member. No raw secrets.
curl -sS --fail-with-body --max-time 60 \
  -H @<(printf 'Authorization: Bearer %s\n' "$auth_token") \
  -H 'Content-Type: application/json' --data-binary "$body" \
  "${base%/}/teams/$1/trello-integrations/$2/execute"
printf '\n'
