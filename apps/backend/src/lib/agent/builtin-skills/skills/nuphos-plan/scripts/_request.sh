#!/usr/bin/env bash
set -euo pipefail
if [[ -n "${OPENAB_CREDENTIALS_DIR:-}" ]]; then
  NUPHOS_PLAN_API_TOKEN=$(cat "$OPENAB_CREDENTIALS_DIR/NUPHOS_PLAN_API_TOKEN" 2>/dev/null || true)
  export NUPHOS_PLAN_API_TOKEN
fi

if [[ $# -lt 2 ]]; then
  printf 'usage: _request.sh METHOD PATH [JSON_BODY]\n' >&2
  exit 2
fi
method=$1
path=$2
body=${3-}
: "${NUPHOS_PLAN_API_BASE:?Nuphos Plan API context is unavailable}"
: "${NUPHOS_PLAN_API_TOKEN:?Nuphos Plan API authorization is unavailable}"

tmp_dir=$(mktemp -d)
trap 'rm -rf "$tmp_dir"' EXIT
chmod 700 "$tmp_dir"
config="$tmp_dir/curl.conf"
response="$tmp_dir/response.json"
body_file="$tmp_dir/body.json"

{
  printf 'silent\nshow-error\nconnect-timeout = 10\nmax-time = 30\n'
  printf 'request = "%s"\n' "$method"
  printf 'url = "%s%s"\n' "${NUPHOS_PLAN_API_BASE%/}" "$path"
  printf 'header = "Authorization: Bearer %s"\n' "$NUPHOS_PLAN_API_TOKEN"
  printf 'header = "Accept: application/json"\n'
  printf 'output = "%s"\n' "$response"
  printf 'write-out = "%%{http_code}"\n'
} >"$config"
chmod 600 "$config"

curl_args=(--config "$config")
if [[ -n "$body" ]]; then
  printf '%s' "$body" >"$body_file"
  chmod 600 "$body_file"
  curl_args+=(--header 'Content-Type: application/json' --data-binary "@$body_file")
fi

status=$(curl "${curl_args[@]}")
if [[ ! "$status" =~ ^2 ]]; then
  printf 'Nuphos Plan API failed (HTTP %s): ' "$status" >&2
  jq -c . "$response" >&2 2>/dev/null || cat "$response" >&2
  printf '\n' >&2
  exit 1
fi

jq . "$response"
