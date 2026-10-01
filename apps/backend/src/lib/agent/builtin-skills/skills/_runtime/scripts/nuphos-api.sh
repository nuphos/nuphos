#!/usr/bin/env bash
set -euo pipefail
if [[ -n "${OPENAB_CREDENTIALS_DIR:-}" ]]; then
  NUPHOS_TOKEN=$(cat "$OPENAB_CREDENTIALS_DIR/NUPHOS_TOKEN" 2>/dev/null || true)
  export NUPHOS_TOKEN
fi

if [[ $# -lt 2 || $# -gt 3 ]]; then
  printf 'usage: nuphos-api.sh METHOD PATH [JSON_OR_@FILE]\n' >&2
  exit 2
fi

method=$(printf '%s' "$1" | tr '[:lower:]' '[:upper:]')
path=$2
body=${3-}

case "$method" in
  GET | POST | PUT | PATCH | DELETE) ;;
  *)
    printf 'Unsupported Nuphos API method: %s\n' "$method" >&2
    exit 2
    ;;
esac

if [[ "$path" != /* ]]; then
  printf 'Nuphos API path must start with /\n' >&2
  exit 2
fi
if [[ "$path" =~ [[:cntrl:]] ]]; then
  printf 'Nuphos API path must not contain control characters\n' >&2
  exit 2
fi

: "${NUPHOS_TOKEN:?Nuphos API authorization is unavailable}"
if [[ ! "$NUPHOS_TOKEN" =~ ^[A-Za-z0-9._-]+$ ]]; then
  printf 'Nuphos API authorization has an invalid format\n' >&2
  exit 2
fi

# The API origin is signed into the conversation JWT. Deriving it from the
# token prevents a command from redirecting the bearer by overriding an env
# variable, while still supporting local developer tunnels and cluster-local
# service URLs.
base=$(python3 <<'PY'
import base64
import json
import os
import sys
import urllib.parse

try:
    payload = os.environ["NUPHOS_TOKEN"].split(".")[1]
    payload += "=" * (-len(payload) % 4)
    origin = json.loads(base64.urlsafe_b64decode(payload))["ori"]
    parsed = urllib.parse.urlsplit(origin)
    if (
        parsed.scheme not in {"http", "https"}
        or not parsed.hostname
        or parsed.username is not None
        or parsed.password is not None
        or parsed.query
        or parsed.fragment
        or parsed.path not in {"", "/"}
    ):
        raise ValueError("invalid origin")
    print(origin.rstrip("/"))
except Exception:
    print("Nuphos conversation token has no valid API origin binding", file=sys.stderr)
    raise SystemExit(2)
PY
)

request_dir=$(mktemp -d)
trap 'rm -rf "$request_dir"' EXIT
chmod 700 "$request_dir"
config="$request_dir/curl.conf"
response="$request_dir/response"
body_file="$request_dir/body.json"

{
  printf 'silent\nshow-error\nconnect-timeout = 10\nmax-time = 300\n'
  printf 'header = "Authorization: Bearer %s"\n' "$NUPHOS_TOKEN"
  printf 'header = "Accept: application/json"\n'
  printf 'output = "%s"\n' "$response"
  printf 'write-out = "%%{http_code}"\n'
} >"$config"
chmod 600 "$config"

curl_args=(
  --config "$config"
  --proto '=http,https'
  --max-redirs 0
  --request "$method"
  --url "${base}${path}"
)
if [[ -n "$body" ]]; then
  if [[ "$body" == @* ]]; then
    source_file=${body#@}
    if [[ ! -f "$source_file" ]]; then
      printf 'JSON body file not found: %s\n' "$source_file" >&2
      exit 2
    fi
    cp "$source_file" "$body_file"
  else
    printf '%s' "$body" >"$body_file"
  fi
  chmod 600 "$body_file"
  curl_args+=(--header 'Content-Type: application/json' --data-binary "@$body_file")
fi

status=$(curl "${curl_args[@]}")
if [[ ! "$status" =~ ^2 ]]; then
  printf 'Nuphos API failed (HTTP %s): ' "$status" >&2
  python3 - "$response" <<'PY' >&2
import json, pathlib, sys
p = pathlib.Path(sys.argv[1])
raw = p.read_text(errors="replace") if p.exists() else ""
try:
    print(json.dumps(json.loads(raw), ensure_ascii=False, separators=(",", ":")))
except Exception:
    print(raw)
PY
  exit 1
fi

if [[ "$status" == 204 || ! -s "$response" ]]; then
  exit 0
fi

python3 - "$response" <<'PY'
import json, pathlib, sys
raw = pathlib.Path(sys.argv[1]).read_text(errors="replace")
try:
    print(json.dumps(json.loads(raw), ensure_ascii=False, indent=2))
except Exception:
    print(raw, end="" if raw.endswith("\n") else "\n")
PY
