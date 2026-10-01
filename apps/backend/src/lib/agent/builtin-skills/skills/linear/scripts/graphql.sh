#!/usr/bin/env bash
set -euo pipefail

env_path="${LINEAR_ENV_PATH:-$HOME/.linear/nuphos.env}"
graphql_url="https://api.linear.app/graphql"
payload_path="${1:--}"

if [ ! -r "$env_path" ]; then
  echo "Linear credentials are not loaded. Run the exact setupCommand from the session credential context first." >&2
  exit 1
fi

# setup-credentials.sh creates this file with mode 0600 and shell-quoted values.
# Load it inside every invocation because agent shell calls do not share state.
# shellcheck disable=SC1090
source "$env_path"

if [ -z "${LINEAR_ACCESS_TOKEN:-}" ]; then
  echo "LINEAR_ACCESS_TOKEN is missing from $env_path; run setup-credentials.sh again." >&2
  exit 1
fi

if [ "$payload_path" != "-" ] && [ ! -r "$payload_path" ]; then
  echo "GraphQL payload is not readable: $payload_path" >&2
  exit 2
fi

response="$(mktemp)"
trap 'rm -f "$response"' EXIT

http_status="$({
  /usr/bin/curl -sS \
    --connect-timeout 10 \
    --max-time 45 \
    -o "$response" \
    -w '%{http_code}' \
    -H "Authorization: Bearer ${LINEAR_ACCESS_TOKEN}" \
    -H 'Content-Type: application/json' \
    --data-binary "@${payload_path}" \
    "$graphql_url"
} || true)"

if [[ ! "$http_status" =~ ^2[0-9][0-9]$ ]]; then
  echo "Linear GraphQL HTTP ${http_status:-request-failed}" >&2
  python3 -m json.tool "$response" >&2 2>/dev/null || sed -n '1,40p' "$response" >&2
  exit 1
fi

python3 - "$response" <<'PY'
import json
import sys

with open(sys.argv[1]) as src:
    data = json.load(src)

if data.get("errors"):
    print(json.dumps({"errors": data["errors"]}, ensure_ascii=False, indent=2), file=sys.stderr)
    raise SystemExit(1)

print(json.dumps(data, ensure_ascii=False, indent=2))
PY
