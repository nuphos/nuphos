#!/usr/bin/env bash
set -euo pipefail
if [[ -n "${OPENAB_CREDENTIALS_DIR:-}" ]]; then
  NUPHOS_TOKEN=$(cat "$OPENAB_CREDENTIALS_DIR/NUPHOS_TOKEN" 2>/dev/null || true)
  export NUPHOS_TOKEN
fi

if [ "$#" -ne 2 ]; then
  echo "Usage: setup-credentials.sh <teamId> <bindingId>" >&2
  exit 2
fi

team_id="$1"
binding_id="$2"
base="${NUPHOS_BACKEND_URL:-${NUPHOS_API_URL:-https://api.nuphos.ai}}"
base="${base%/}"

urlencode() {
  python3 - "$1" <<'PY'
import sys, urllib.parse
print(urllib.parse.quote(sys.argv[1], safe=""))
PY
}

read_local_nuphos_token() {
  python3 <<'PY'
from pathlib import Path
import re
path = Path.home() / ".config" / "nuphos" / "cli.yaml"
try:
    text = path.read_text()
except FileNotFoundError:
    raise SystemExit(0)
match = re.search(r'(?m)^token:\s*(.+?)\s*$', text)
if match:
    token = match.group(1).strip()
    if (token.startswith('"') and token.endswith('"')) or (token.startswith("'") and token.endswith("'")):
        token = token[1:-1]
    print(token)
PY
}

auth_token="${NUPHOS_TOKEN:-}"
if [ -z "$auth_token" ]; then
  auth_token="$(read_local_nuphos_token || true)"
fi
if [ -z "$auth_token" ]; then
  echo "NUPHOS_TOKEN is not set and ~/.config/nuphos/cli.yaml has no token" >&2
  exit 1
fi

team_enc="$(urlencode "$team_id")"
binding_enc="$(urlencode "$binding_id")"
path="/teams/${team_enc}/upstash-accounts/${binding_enc}/credentials"

tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT

curl -fsSL \
  --connect-timeout 10 \
  --max-time 30 \
  --retry 3 \
  --retry-delay 1 \
  --retry-connrefused \
  -H "Authorization: Bearer ${auth_token}" \
  -H "Accept: application/json" \
  "${base}${path}" > "$tmp"

mkdir -p "$HOME/.upstash"
chmod 700 "$HOME/.upstash"

# 600 before writing, so the key never exists under a permissive umask.
touch "$HOME/.upstash/nuphos.env"
chmod 600 "$HOME/.upstash/nuphos.env"

python3 - "$tmp" "$HOME/.upstash/nuphos.env" <<'PY'
import json, shlex, sys
src, dst = sys.argv[1], sys.argv[2]
data = json.load(open(src))

# Validate before opening `dst` for writing: open(dst, "w") truncates, so a
# malformed-but-successful response would wipe working credentials on the way
# to failing.
email = (data.get("email") or "").strip()
api_key = (data.get("apiKey") or "").strip()
if not email or not api_key:
    raise SystemExit("Credentials response missing email/apiKey; re-bind the Upstash account.")

with open(dst, "w") as f:
    f.write("unset UPSTASH_EMAIL UPSTASH_API_KEY\n")
    f.write(f"export UPSTASH_EMAIL={shlex.quote(email)}\n")
    f.write(f"export UPSTASH_API_KEY={shlex.quote(api_key)}\n")
    f.write(f"export UPSTASH_BINDING_ID={shlex.quote(str(data.get('bindingId', '')))}\n")
PY

chmod 600 "$HOME/.upstash/nuphos.env"
echo "Wrote Upstash credentials to ~/.upstash/nuphos.env"
