#!/usr/bin/env bash
set -euo pipefail
if [[ -n "${OPENAB_CREDENTIALS_DIR:-}" ]]; then
  NUPHOS_TOKEN=$(cat "$OPENAB_CREDENTIALS_DIR/NUPHOS_TOKEN" 2>/dev/null || true)
  export NUPHOS_TOKEN
fi

usage() {
  cat >&2 <<EOF
Usage: setup-credentials.sh <teamId> <accountId> [region]

Fetches the team's Alibaba Cloud RAM credentials from the Nuphos backend (using
the user's NUPHOS_TOKEN) for an Nuphos-bound Alibaba Cloud account, then writes
them to ~/.aliyun/config.json so plain \`aliyun\` CLI commands work.

Arguments:
  teamId     Nuphos team id (24-char hex)
  accountId  Nuphos Alibaba Cloud account binding id (24-char hex)
  region     Optional default region. If omitted, the backend's partition-aware
             defaultRegion is used (cn-hangzhou for China / ap-southeast-1 for
             International accounts).

Required env: NUPHOS_TOKEN. Optional env: NUPHOS_BACKEND_URL (defaults to https://api.nuphos.ai).
EOF
  exit 1
}

if [ "$#" -lt 2 ]; then usage; fi

# Region: explicit arg wins; otherwise the backend's partition-aware
# defaultRegion is used (empty here → filled from the credentials response below).
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
url="${base}/teams/${team_id}/aliyun-accounts/${account_id}/credentials"

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

mkdir -p "$HOME/.aliyun"
chmod 700 "$HOME/.aliyun"

umask 077

# Resolve the effective region here so the success message below is accurate.
# No explicit arg → use the backend's partition-aware defaultRegion (China vs
# International), falling back to cn-hangzhou for legacy or malformed
# responses. The try/except matters under `set -e`: a truncated body must fall
# back, not kill the script before the credential write (which does its own
# strict validation below).
if [ -z "$region" ]; then
  region="$(python3 -c '
import json, sys
try:
    d = json.load(open(sys.argv[1]))
    r = d.get("defaultRegion")
except Exception:
    r = None
print(r if isinstance(r, str) and r else "cn-hangzhou")
' "$tmp")"
fi

# Let Python validate the backend response and emit ~/.aliyun/config.json with
# json.dump — never reparse secrets as shell (no eval) or hand-interpolate JSON.
# Trust-relationship model: these are short-lived assumed-role STS credentials
# (AccessKeyId/AccessKeySecret + securityToken), so the CLI uses "StsToken" mode.
python3 - "$tmp" "$HOME/.aliyun/config.json" "$region" <<'PY'
import json
import sys

response_path, config_path, region = sys.argv[1:4]
with open(response_path, encoding="utf-8") as f:
    data = json.load(f)

access_key_id = data["accessKeyId"]
access_key_secret = data["accessKeySecret"]
sts_token = data.get("securityToken", "")
if not isinstance(access_key_id, str) or not isinstance(access_key_secret, str) or not isinstance(sts_token, str) or not sts_token:
    raise SystemExit("credentials response must contain string accessKeyId, accessKeySecret and securityToken")

config = {
    "current": "default",
    "profiles": [
        {
            "name": "default",
            "mode": "StsToken",
            "access_key_id": access_key_id,
            "access_key_secret": access_key_secret,
            "sts_token": sts_token,
            "region_id": region,
            "output_format": "json",
            "language": "en",
        }
    ],
    "meta_path": "",
}
with open(config_path, "w", encoding="utf-8") as f:
    json.dump(config, f, indent=2)
    f.write("\n")
PY

echo "Wrote Alibaba Cloud credentials to ~/.aliyun/config.json"
echo "  region: ${region}"
