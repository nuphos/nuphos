#!/usr/bin/env bash
set -euo pipefail
if [[ -n "${OPENAB_CREDENTIALS_DIR:-}" ]]; then
  NUPHOS_TOKEN=$(cat "$OPENAB_CREDENTIALS_DIR/NUPHOS_TOKEN" 2>/dev/null || true)
  export NUPHOS_TOKEN
fi

usage() {
  cat >&2 <<EOF
Usage: setup-credentials.sh <teamId> <accountId> [region]

Fetches the team's Tencent CAM credentials from the Nuphos backend (using the
user's NUPHOS_TOKEN) for an Nuphos-bound Tencent account, then writes them to
~/.tccli/default.credential + ~/.tccli/default.configure so plain \`tccli\`
commands work.

Arguments:
  teamId     Nuphos team id (24-char hex)
  accountId  Nuphos Tencent account binding id (24-char hex)
  region     Optional default region. If omitted, the backend's partition-aware
             defaultRegion is used (ap-guangzhou for mainland-China accounts /
             ap-singapore for International accounts).

Required env: NUPHOS_TOKEN. Optional env: NUPHOS_BACKEND_URL (defaults to https://api.nuphos.ai).
EOF
  exit 1
}

if [ "$#" -lt 2 ]; then usage; fi

# Region: explicit arg wins; otherwise the backend's partition-aware
# defaultRegion is used (resolved after the credentials fetch below).
team_id="$1"
account_id="$2"
region="${3:-}"

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
url="${base}/teams/${team_id}/tencent-accounts/${account_id}/credentials"

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

mkdir -p "$HOME/.tccli"
chmod 700 "$HOME/.tccli"

umask 077

# Resolve the effective region here so the success message below is accurate.
# No explicit arg → use the backend's partition-aware defaultRegion (mainland
# China vs International), falling back to ap-guangzhou for legacy or
# malformed responses. The try/except matters under `set -e`: a truncated body
# must fall back, not kill the script before the credential write (which does
# its own strict validation below).
if [ -z "$region" ]; then
  region="$(python3 -c '
import json, sys
try:
    d = json.load(open(sys.argv[1]))
    r = d.get("defaultRegion")
except Exception:
    r = None
print(r if isinstance(r, str) and r else "ap-guangzhou")
' "$tmp")"
fi

# Let Python validate the backend response and emit the tccli files with
# json.dump — never reparse secrets as shell (no eval) or hand-interpolate JSON
# (no escaping bugs). Trust-relationship model: these are short-lived
# assumed-role STS credentials (SecretId/SecretKey + token), so the tccli
# profile uses the "token" type.
python3 - "$tmp" "$HOME/.tccli/default.credential" "$HOME/.tccli/default.configure" "$region" <<'PY'
import json
import sys

response_path, credential_path, configure_path, region = sys.argv[1:5]
with open(response_path, encoding="utf-8") as f:
    data = json.load(f)

secret_id = data["secretId"]
secret_key = data["secretKey"]
token = data.get("token", "")
if not all(isinstance(v, str) and v for v in (secret_id, secret_key, token)):
    raise SystemExit("credentials response must contain non-empty secretId, secretKey and token")

with open(credential_path, "w", encoding="utf-8") as f:
    json.dump({"type": "token", "secretId": secret_id, "secretKey": secret_key, "token": token}, f, indent=2)
    f.write("\n")

with open(configure_path, "w", encoding="utf-8") as f:
    json.dump({"region": region, "output": "json"}, f, indent=2)
    f.write("\n")
PY

echo "Wrote Tencent credentials to ~/.tccli/default.credential"
echo "  region: ${region}"
