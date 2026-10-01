#!/usr/bin/env bash
set -euo pipefail
if [[ -n "${OPENAB_CREDENTIALS_DIR:-}" ]]; then
  NUPHOS_TOKEN=$(cat "$OPENAB_CREDENTIALS_DIR/NUPHOS_TOKEN" 2>/dev/null || true)
  export NUPHOS_TOKEN
fi

usage() {
  cat >&2 <<EOF
Usage: setup-credentials.sh <teamId> <accountId>

Fetches Linode API credentials from Nuphos backend (using the user's
NUPHOS_TOKEN) for a selected Nuphos-bound Linode account, then writes a private
linode-cli config so plain \`linode-cli\` commands work in later tool calls.

Arguments:
  teamId     Nuphos team id (24-char hex)
  accountId  Nuphos Linode account binding id

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
url="${base}/teams/${team_id}/linode-accounts/${account_id}/credentials"

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

config_dir="$HOME/.config"
config_path="$config_dir/linode-cli"
env_dir="$HOME/.linode"
env_path="$env_dir/nuphos.env"
mkdir -p "$config_dir" "$env_dir"
chmod 700 "$env_dir"

python3 - "$tmp" "$config_path" "$env_path" <<'PY'
import json, shlex, sys

src, config_path, env_path = sys.argv[1], sys.argv[2], sys.argv[3]
d = json.load(open(src))
token = d["token"].strip()
if not token:
    raise SystemExit("Credentials response missing a non-empty token")
label = d.get("label") or d["accountId"]
# linode-cli resolves the token from the [<default-user>] section, not from
# [DEFAULT]. Pointing default-user at a section that doesn't exist makes
# get_token() return "" -> "401 Invalid Token". Mirror the layout that
# `linode-cli configure` writes: token under a named user section.
user = "nuphos"
with open(config_path, "w") as f:
    f.write("[DEFAULT]\n")
    f.write(f"default-user = {user}\n\n")
    f.write(f"[{user}]\n")
    f.write(f"token = {token}\n")
    f.write("region = us-east\n")
    f.write("type = g6-nanode-1\n")
    f.write("image = linode/debian12\n")
with open(env_path, "w") as f:
    f.write(f"export LINODE_CLI_TOKEN={shlex.quote(token)}\n")
    f.write(f"export LINODE_ACCOUNT_ID={shlex.quote(d['accountId'])}\n")
    f.write(f"export LINODE_ACCOUNT_LABEL={shlex.quote(label)}\n")
PY

chmod 600 "$config_path" "$env_path"

echo "Wrote Linode CLI credentials to ~/.config/linode-cli"
echo "  account: ${account_id}"
echo "Run: linode-cli profile view --json"
