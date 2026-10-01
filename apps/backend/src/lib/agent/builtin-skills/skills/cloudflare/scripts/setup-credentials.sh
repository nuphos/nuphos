#!/usr/bin/env bash
set -euo pipefail
if [[ -n "${OPENAB_CREDENTIALS_DIR:-}" ]]; then
  NUPHOS_TOKEN=$(cat "$OPENAB_CREDENTIALS_DIR/NUPHOS_TOKEN" 2>/dev/null || true)
  export NUPHOS_TOKEN
fi

usage() {
  cat >&2 <<EOF
Usage: setup-credentials.sh <teamId> <accountId>

Fetches Cloudflare API credentials from Nuphos backend (using the user's
NUPHOS_TOKEN) for an Nuphos-bound account, then writes a private env file at
~/.cloudflare/nuphos.env for later curl/API calls.

Arguments:
  teamId     Nuphos team id (24-char hex)
  accountId  Cloudflare account id (32-char hex) bound to the team

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
url="${base}/teams/${team_id}/cloudflare-accounts/${account_id}/credentials"

tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT

http_code="$(curl -sS -o "$tmp" -w '%{http_code}' \
  -H "Authorization: Bearer ${NUPHOS_TOKEN}" \
  -H 'Accept: application/json' \
  "$url")"

if [ "$http_code" != "200" ]; then
  echo "Nuphos backend returned HTTP ${http_code} for ${url}:" >&2
  cat "$tmp" >&2
  echo >&2
  exit 1
fi

mkdir -p "$HOME/.cloudflare"
chmod 700 "$HOME/.cloudflare"

python3 - "$tmp" "$HOME/.cloudflare/nuphos.env" <<'PY'
import json, shlex, sys

src, dest = sys.argv[1], sys.argv[2]
d = json.load(open(src))
with open(dest, "w") as f:
    f.write(f"export CLOUDFLARE_ACCOUNT_ID={shlex.quote(d['accountId'])}\n")
    f.write(f"export CLOUDFLARE_API_KEY={shlex.quote(d['apiKey'])}\n")
    f.write("export CLOUDFLARE_AUTH_TYPE=api_token\n")
    f.write("unset CLOUDFLARE_EMAIL\n")
    if d.get("accountName"):
        f.write(f"export CLOUDFLARE_ACCOUNT_NAME={shlex.quote(d['accountName'])}\n")
PY

chmod 600 "$HOME/.cloudflare/nuphos.env"

echo "Wrote Cloudflare credentials to ~/.cloudflare/nuphos.env"
echo "  account:   ${account_id}"
echo "  auth type: api_token"
