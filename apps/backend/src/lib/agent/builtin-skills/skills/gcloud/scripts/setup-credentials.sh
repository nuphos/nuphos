#!/usr/bin/env bash
set -euo pipefail
if [[ -n "${OPENAB_CREDENTIALS_DIR:-}" ]]; then
  NUPHOS_TOKEN=$(cat "$OPENAB_CREDENTIALS_DIR/NUPHOS_TOKEN" 2>/dev/null || true)
  export NUPHOS_TOKEN
fi

usage() {
  cat >&2 <<EOF
Usage: setup-credentials.sh <teamId> <projectId> [serviceAccountId]

Fetches a short-lived GCP access token from Nuphos backend (using the user's
NUPHOS_TOKEN) and configures gcloud to use it for the bound project. The token
is saved under CLOUDSDK_CONFIG (default: ~/.config/gcloud) and gcloud's
auth/access_token_file is pointed at it. Token lifetime is ~1h.

Required env: NUPHOS_TOKEN. Optional env: CLOUDSDK_CONFIG, NUPHOS_BACKEND_URL (defaults to https://api.nuphos.ai).
EOF
  exit 1
}

if [ "$#" -lt 2 ]; then usage; fi

team_id="$1"
project_id="$2"
service_account_id="${3:-}"

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
# session's service-account selection and permission-admin prohibition.
url="${base}/teams/${team_id}/gcp-projects/${project_id}/credentials"
if [ -n "$service_account_id" ]; then
  url="${url}?serviceAccountId=${service_account_id}"
fi

tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT

echo "Fetching Nuphos-managed GCP access token" >&2
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

echo "Parsing GCP credentials response" >&2
parsed="$(python3 -c '
import json, sys, shlex
d = json.load(open(sys.argv[1]))
for k in ("accessToken", "projectId", "serviceAccountEmail", "expiresAt"):
    print(f"{k}={shlex.quote(d[k])}")
' "$tmp")"
eval "$parsed"

token_dir="${CLOUDSDK_CONFIG:-$HOME/.config/gcloud}"
config_dir="$token_dir/configurations"
mkdir -p "$token_dir"
mkdir -p "$config_dir"
chmod 700 "$token_dir"
safe_config_name="$(printf '%s' "${service_account_id:-${projectId}-${serviceAccountEmail}}" | tr -c 'A-Za-z0-9_.-' '-' | cut -c1-80)"
if [ -z "$safe_config_name" ]; then
  safe_config_name="default"
fi
config_name="nuphos-${safe_config_name}"
token_path="$token_dir/nuphos-access-token-${safe_config_name}"
config_path="$config_dir/config_${config_name}"
active_config_path="$token_dir/active_config"

umask 077
printf '%s' "$accessToken" > "$token_path"
printf '%s\n' "$config_name" > "$active_config_path"

cat > "$config_path" <<EOF
[auth]
access_token_file = $token_path

[component_manager]
disable_update_check = true

[core]
account = $serviceAccountEmail
disable_prompts = true
disable_usage_reporting = true
project = $projectId
EOF

echo "Wrote gcloud access-token config" >&2
echo "Configured gcloud with Nuphos-managed token"
echo "  project:         ${projectId}"
echo "  service account: ${serviceAccountEmail}"
echo "  expires at:      ${expiresAt}"
echo
echo "Note: gcloud config \"$config_name\" uses auth/access_token_file=\"$token_path\". For commands"
echo "that don't honor that config (rare), set CLOUDSDK_AUTH_ACCESS_TOKEN=\"\$(cat \"$token_path\")\" inline."
