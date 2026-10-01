#!/usr/bin/env bash
set -euo pipefail
if [[ -n "${OPENAB_CREDENTIALS_DIR:-}" ]]; then
  NUPHOS_TOKEN=$(cat "$OPENAB_CREDENTIALS_DIR/NUPHOS_TOKEN" 2>/dev/null || true)
  export NUPHOS_TOKEN
fi

usage() {
  cat >&2 <<EOF
Usage: setup-credentials.sh <teamId> <accountId> [region]

Fetches the team's Volcengine IAM credentials from the Nuphos backend (using
the user's NUPHOS_TOKEN) for a Nuphos-bound Volcengine account, then writes a
sourceable env file at ~/.volc/credentials.env, exporting both naming schemes:
VOLC_ACCESSKEY / VOLC_SECRETKEY / VOLC_SESSION_TOKEN / VOLC_REGION for the SDKs,
and VOLCENGINE_ACCESS_KEY / VOLCENGINE_SECRET_KEY / VOLCENGINE_SESSION_TOKEN /
VOLCENGINE_REGION for the ve CLI.

Arguments:
  teamId     Nuphos team id (24-char hex)
  accountId  Nuphos Volcengine account binding id (24-char hex)
  region     Optional default region. If omitted, the backend's defaultRegion
             is used (cn-beijing).

After running:  source ~/.volc/credentials.env

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
url="${base}/teams/${team_id}/volcengine-accounts/${account_id}/credentials"

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

mkdir -p "$HOME/.volc"
chmod 700 "$HOME/.volc"

umask 077

# Resolve the effective region here so the success message below is accurate.
# No explicit arg → use the backend's defaultRegion, falling back to cn-beijing
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
print(r if isinstance(r, str) and r else "cn-beijing")
' "$tmp")"
fi

# Let Python validate the backend response and emit the env file with
# shlex.quote — never reparse secrets as shell (no eval) or hand-interpolate.
python3 - "$tmp" "$HOME/.volc/credentials.env" "$region" <<'PY'
import json
import shlex
import sys

response_path, env_path, region = sys.argv[1:4]
with open(response_path, encoding="utf-8") as f:
    data = json.load(f)

access_key_id = data["accessKeyId"]
secret_access_key = data["secretAccessKey"]
# Trust-relationship model: these are short-lived assumed-role credentials, so a
# session token is required alongside the AK/SK.
session_token = data.get("sessionToken", "")
if not isinstance(access_key_id, str) or not isinstance(secret_access_key, str):
    raise SystemExit("credentials response must contain string accessKeyId and secretAccessKey")

# Volcengine ships two naming conventions and neither reads the other's: the
# SDKs (Go, Python) take VOLC_*, the ve CLI takes VOLCENGINE_*. Export both.
NAMES = (
    ("VOLC_ACCESSKEY", "VOLC_SECRETKEY", "VOLC_SESSION_TOKEN", "VOLC_REGION"),
    ("VOLCENGINE_ACCESS_KEY", "VOLCENGINE_SECRET_KEY", "VOLCENGINE_SESSION_TOKEN", "VOLCENGINE_REGION"),
)

with open(env_path, "w", encoding="utf-8") as f:
    for ak, sk, token, reg in NAMES:
        f.write(f"export {ak}={shlex.quote(access_key_id)}\n")
        f.write(f"export {sk}={shlex.quote(secret_access_key)}\n")
        if isinstance(session_token, str) and session_token:
            f.write(f"export {token}={shlex.quote(session_token)}\n")
        else:
            # Refreshing is a re-run + re-source into the same shell, so an
            # absent token has to erase the previous one rather than leave it
            # paired with the new key.
            f.write(f"unset {token}\n")
        f.write(f"export {reg}={shlex.quote(region)}\n")
PY

echo "Wrote Volcengine credentials to ~/.volc/credentials.env"
echo "  region: ${region}"
echo "Run:  source ~/.volc/credentials.env"
