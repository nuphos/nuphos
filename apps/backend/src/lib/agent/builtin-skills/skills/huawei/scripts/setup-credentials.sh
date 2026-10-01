#!/usr/bin/env bash
set -euo pipefail
if [[ -n "${OPENAB_CREDENTIALS_DIR:-}" ]]; then
  NUPHOS_TOKEN=$(cat "$OPENAB_CREDENTIALS_DIR/NUPHOS_TOKEN" 2>/dev/null || true)
  export NUPHOS_TOKEN
fi

usage() {
  cat >&2 <<EOF
Usage: setup-credentials.sh <teamId> <accountId> [region]

Fetches short-lived Huawei Cloud credentials from the Nuphos backend (using the
user's NUPHOS_TOKEN) for a Nuphos-bound Huawei Cloud account, then writes a
sourceable env file at ~/.huawei/credentials.env, exporting both naming schemes:
HUAWEICLOUD_SDK_AK / HUAWEICLOUD_SDK_SK / HUAWEICLOUD_SDK_SECURITY_TOKEN /
HUAWEICLOUD_SDK_REGION for hw-api.py and Huawei's SDKs, and HW_ACCESS_KEY /
HW_SECRET_KEY / HW_SECURITY_TOKEN / HW_REGION_NAME for Terraform. The account
(domain) id is exported as HUAWEICLOUD_DOMAIN_ID, since federated credentials
carry no IAM user.

Arguments:
  teamId     Nuphos team id (24-char hex)
  accountId  Nuphos Huawei Cloud account binding id (24-char hex)
  region     Optional default region. If omitted, the backend's defaultRegion
             is used (cn-north-4).

After running:  source ~/.huawei/credentials.env

Required env: NUPHOS_TOKEN. Optional env: NUPHOS_BACKEND_URL (defaults to https://api.nuphos.ai).
EOF
  exit 1
}

if [ "$#" -lt 2 ]; then usage; fi

# Region: explicit arg wins; otherwise the backend's defaultRegion is used
# (resolved after the credentials fetch below).
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
url="${base}/teams/${team_id}/huawei-accounts/${account_id}/credentials"

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

mkdir -p "$HOME/.huawei"
chmod 700 "$HOME/.huawei"

umask 077

# Resolve the effective region here so the success message below is accurate.
# No explicit arg → use the backend's defaultRegion, falling back to cn-north-4
# for legacy or malformed responses. The try/except matters under `set -e`: a
# truncated body must fall back, not kill the script before the credential
# write (which does its own strict validation below).
if [ -z "$region" ]; then
  region="$(python3 -c '
import json, sys
try:
    d = json.load(open(sys.argv[1]))
    r = d.get("defaultRegion")
except Exception:
    r = None
print(r if isinstance(r, str) and r else "cn-north-4")
' "$tmp")"
fi

# Let Python validate the backend response and emit the env file with
# shlex.quote — never reparse secrets as shell (no eval) or hand-interpolate.
python3 - "$tmp" "$HOME/.huawei/credentials.env" "$region" <<'PY'
import json
import shlex
import sys

response_path, env_path, region = sys.argv[1:4]
with open(response_path, encoding="utf-8") as f:
    data = json.load(f)

access_key_id = data["accessKeyId"]
secret_access_key = data["secretAccessKey"]
# Federation model: these are temporary credentials, so the security token is
# required alongside the AK/SK.
security_token = data.get("securityToken", "")
domain_id = data.get("domainId", "")
if not isinstance(access_key_id, str) or not isinstance(secret_access_key, str):
    raise SystemExit("credentials response must contain string accessKeyId and secretAccessKey")

# hw-api.py and the SDKs read HUAWEICLOUD_SDK_*; the Terraform provider reads HW_*.
# Neither reads the other's, so export both.
NAMES = (
    ("HUAWEICLOUD_SDK_AK", "HUAWEICLOUD_SDK_SK", "HUAWEICLOUD_SDK_SECURITY_TOKEN", "HUAWEICLOUD_SDK_REGION"),
    ("HW_ACCESS_KEY", "HW_SECRET_KEY", "HW_SECURITY_TOKEN", "HW_REGION_NAME"),
)

with open(env_path, "w", encoding="utf-8") as f:
    for ak, sk, token, reg in NAMES:
        f.write(f"export {ak}={shlex.quote(access_key_id)}\n")
        f.write(f"export {sk}={shlex.quote(secret_access_key)}\n")
        if isinstance(security_token, str) and security_token:
            f.write(f"export {token}={shlex.quote(security_token)}\n")
        else:
            # Refreshing is a re-run + re-source into the same shell, so an
            # absent token has to erase the previous one rather than leave it
            # paired with the new key.
            f.write(f"unset {token}\n")
        f.write(f"export {reg}={shlex.quote(region)}\n")
    if isinstance(domain_id, str) and domain_id:
        f.write(f"export HUAWEICLOUD_DOMAIN_ID={shlex.quote(domain_id)}\n")
    else:
        f.write("unset HUAWEICLOUD_DOMAIN_ID\n")
PY

echo "Wrote Huawei Cloud credentials to ~/.huawei/credentials.env"
echo "  region: ${region}"
echo "Run:  source ~/.huawei/credentials.env"
