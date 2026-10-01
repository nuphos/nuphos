#!/usr/bin/env bash
set -euo pipefail
if [[ -n "${OPENAB_CREDENTIALS_DIR:-}" ]]; then
  NUPHOS_TOKEN=$(cat "$OPENAB_CREDENTIALS_DIR/NUPHOS_TOKEN" 2>/dev/null || true)
  export NUPHOS_TOKEN
fi

usage() {
  cat >&2 <<EOF
Usage: setup-credentials.sh <teamId> <accountId> [region] [roleId]

Fetches short-lived AWS STS credentials from Nuphos backend (using the user's
NUPHOS_TOKEN) for an Nuphos-bound account, then writes them to ~/.aws/credentials
+ ~/.aws/config so plain \`aws\` commands work for the next ~1 hour.

Arguments:
  teamId     Nuphos team id (24-char hex)
  accountId  AWS account id (12 digits) bound to the team
  region     Optional default region (defaults to us-east-1)
  roleId     Optional Nuphos AWS role binding id when the account has multiple roles

Required env: NUPHOS_TOKEN. Optional env: NUPHOS_BACKEND_URL (defaults to https://api.nuphos.ai).
EOF
  exit 1
}

if [ "$#" -lt 2 ]; then usage; fi

team_id="$1"
account_id="$2"
region="${3:-us-east-1}"
role_id="${4:-}"

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
# The ordinary team API recognizes a conversation token and applies the
# session's role selection, IAM policy, and permission-admin prohibition.
url="${base}/teams/${team_id}/aws-accounts/${account_id}/credentials"
if [ -n "$role_id" ]; then
  url="${url}?roleId=${role_id}"
fi

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

parsed="$(python3 -c '
import json, sys, shlex
d = json.load(open(sys.argv[1]))
for k in ("accessKeyId", "secretAccessKey", "sessionToken", "expiresAt"):
    print(f"{k}={shlex.quote(d[k])}")
' "$tmp")"
eval "$parsed"

mkdir -p "$HOME/.aws"
chmod 700 "$HOME/.aws"

umask 077
cat > "$HOME/.aws/credentials" <<EOF
[default]
aws_access_key_id = ${accessKeyId}
aws_secret_access_key = ${secretAccessKey}
aws_session_token = ${sessionToken}
EOF

cat > "$HOME/.aws/config" <<EOF
[default]
region = ${region}
output = json
EOF

echo "Wrote AWS credentials to ~/.aws/credentials (default profile)"
echo "  region:     ${region}"
echo "  expires at: ${expiresAt}"
