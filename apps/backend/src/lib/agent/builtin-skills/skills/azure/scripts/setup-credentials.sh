#!/usr/bin/env bash
set -euo pipefail
if [[ -n "${OPENAB_CREDENTIALS_DIR:-}" ]]; then
  NUPHOS_TOKEN=$(cat "$OPENAB_CREDENTIALS_DIR/NUPHOS_TOKEN" 2>/dev/null || true)
  export NUPHOS_TOKEN
fi

usage() {
  cat >&2 <<EOF
Usage: setup-credentials.sh <teamId> <accountId>

Fetches a short-lived Azure ARM access token from the Nuphos backend (using the
user's NUPHOS_TOKEN) for an Nuphos-bound Azure subscription, then prints shell
\`export\` lines. Source it so the token is available to later commands:

  source <(bash skills/azure/scripts/setup-credentials.sh <teamId> <accountId>)

Exports:
  AZURE_ACCESS_TOKEN      management.azure.com bearer token (expires ~1h)
  AZURE_SUBSCRIPTION_ID   subscription the token is scoped to

Arguments:
  teamId     Nuphos team id (24-char hex)
  accountId  Nuphos Azure account binding id (24-char hex)

Required env: NUPHOS_TOKEN. Optional env: NUPHOS_BACKEND_URL (defaults to https://api.nuphos.ai).
EOF
  exit 1
}

if [ "$#" -lt 2 ]; then usage; fi

team_id="$1"
account_id="$2"

if [ -z "${NUPHOS_TOKEN:-}" ]; then
  echo "NUPHOS_TOKEN is not set in this sandbox" >&2
  exit 1
fi
if ! command -v python3 >/dev/null 2>&1; then
  echo "python3 is required to parse the credentials response" >&2
  exit 1
fi

base="${NUPHOS_BACKEND_URL:-https://api.nuphos.ai}"
base="${base%/}"
# Conversation tokens are accepted by the ordinary team API; its auth
# middleware applies the conversation's credential selection automatically.
url="${base}/teams/${team_id}/azure-accounts/${account_id}/credentials"

tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT

http_code=""
curl_status=0
for attempt in 1 2 3; do
  : > "$tmp"
  set +e
  http_code="$(curl --http1.1 -sS -o "$tmp" -w '%{http_code}' \
    --connect-timeout 10 \
    --max-time 30 \
    -H "Authorization: Bearer ${NUPHOS_TOKEN}" \
    -H 'Accept: application/json' \
    "$url")"
  curl_status=$?
  set -e
  if [ "$curl_status" -eq 0 ]; then
    break
  fi
  if [ "$attempt" -eq 3 ]; then
    echo "Credential request failed after 3 attempts (curl exit ${curl_status})" >&2
    exit "$curl_status"
  fi
  echo "Credential request failed (curl exit ${curl_status}); retrying" >&2
  sleep "$attempt"
done

if [ "$http_code" != "200" ]; then
  echo "Nuphos backend returned HTTP ${http_code} for ${url}:" >&2
  cat "$tmp" >&2
  echo >&2
  exit 1
fi

# Let Python validate the response and shell-quote the values so a token can
# never break out of the `export` line. Emit to stdout for `source <(...)`.
python3 - "$tmp" <<'PY'
import json
import shlex
import sys

with open(sys.argv[1], encoding="utf-8") as f:
    data = json.load(f)

token = data.get("accessToken")
subscription_id = data.get("subscriptionId")
if not (isinstance(token, str) and token and isinstance(subscription_id, str) and subscription_id):
    raise SystemExit("credentials response must contain non-empty accessToken and subscriptionId")

print(f"export AZURE_ACCESS_TOKEN={shlex.quote(token)}")
print(f"export AZURE_SUBSCRIPTION_ID={shlex.quote(subscription_id)}")
PY

echo "Loaded Azure ARM token for subscription (expires ~1h; re-run to refresh)." >&2
