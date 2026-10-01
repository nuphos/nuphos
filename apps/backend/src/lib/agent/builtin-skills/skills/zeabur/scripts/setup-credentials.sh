#!/usr/bin/env bash
set -euo pipefail
if [[ -n "${OPENAB_CREDENTIALS_DIR:-}" ]]; then
  NUPHOS_TOKEN=$(cat "$OPENAB_CREDENTIALS_DIR/NUPHOS_TOKEN" 2>/dev/null || true)
  export NUPHOS_TOKEN
fi

usage() {
  cat >&2 <<EOF
Usage: setup-credentials.sh <teamId> <zeaburId>

Fetches a Zeabur API token from the Nuphos backend (using the user's
NUPHOS_TOKEN) for a selected Nuphos-bound Zeabur provider, then writes a private
env file so plain GraphQL/curl calls and the \`zeabur\` CLI work in later tool
calls.

Arguments:
  teamId    Nuphos team id (24-char hex)
  zeaburId  Zeabur identity id (the user or team id bound in Nuphos)

Required env: NUPHOS_TOKEN. Optional env: NUPHOS_BACKEND_URL (defaults to https://api.nuphos.ai).

After running, source the env file before each GraphQL/CLI call:
  source ~/.zeabur/nuphos.env
EOF
  exit 1
}

if [ "$#" -lt 2 ]; then usage; fi

team_id="$1"
zeabur_id="$2"

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
url="${base}/teams/${team_id}/zeabur-providers/${zeabur_id}/credentials"

tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT

http_code="$(curl --http1.1 -sS -o "$tmp" -w '%{http_code}' \
  --connect-timeout 10 \
  --max-time 30 \
  -H "Authorization: Bearer ${NUPHOS_TOKEN}" \
  -H 'Accept: application/json' \
  "$url")"

if [ "$http_code" != "200" ]; then
  echo "Nuphos backend returned HTTP ${http_code} for ${url}:" >&2
  cat "$tmp" >&2
  echo >&2
  exit 1
fi

env_dir="$HOME/.zeabur"
env_path="$env_dir/nuphos.env"
mkdir -p "$env_dir"
chmod 700 "$env_dir"

python3 - "$tmp" "$env_path" <<'PY'
import json, shlex, sys

src, env_path = sys.argv[1], sys.argv[2]
d = json.load(open(src))
token = d["token"].strip()
kind = d.get("kind") or "user"
name = d.get("name") or d["zeaburId"]
with open(env_path, "w") as f:
    f.write(f"export ZEABUR_TOKEN={shlex.quote(token)}\n")
    f.write(f"export ZEABUR_ID={shlex.quote(d['zeaburId'])}\n")
    f.write(f"export ZEABUR_KIND={shlex.quote(kind)}\n")
    f.write(f"export ZEABUR_NAME={shlex.quote(name)}\n")
PY

chmod 600 "$env_path"

# Best-effort: configure the zeabur CLI too, if it is present in the runtime
# image. GraphQL-over-curl works regardless of whether the CLI exists.
# shellcheck disable=SC1090
source "$env_path"
if command -v zeabur >/dev/null 2>&1; then
  zeabur auth login --token "$ZEABUR_TOKEN" >/dev/null 2>&1 \
    && echo "Configured zeabur CLI (zeabur auth login)" \
    || echo "zeabur CLI present but token login failed; use GraphQL over curl instead" >&2
fi

echo "Wrote Zeabur credentials to ~/.zeabur/nuphos.env"
echo "  zeaburId: ${zeabur_id}"
echo "Next: source ~/.zeabur/nuphos.env  # exports ZEABUR_TOKEN for GraphQL/CLI calls"
