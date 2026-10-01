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

# Session-scoped ONLY, with no team-scoped fallback: the backend hands out the
# This endpoint exists only for conversation principals; the ordinary team URL
# still enforces that this binding is selected by the current conversation.
path="/teams/${team_enc}/resend-integrations/${binding_enc}/credentials"

tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT

# Capture the HTTP status rather than -f so 403 (not enabled for this
# conversation / not on the allow-list) vs 404 (binding deleted) stay
# distinguishable, and the backend error body is surfaced.
status="$(curl -sSL -o "$tmp" -w '%{http_code}' \
  --connect-timeout 10 \
  --max-time 30 \
  --retry 3 \
  --retry-delay 1 \
  --retry-connrefused \
  -H "Authorization: Bearer ${auth_token}" \
  -H "Accept: application/json" \
  "${base}${path}")"

if [ "$status" != "200" ]; then
  echo "Credential fetch failed with HTTP $status:" >&2
  cat "$tmp" >&2
  exit 1
fi

mkdir -p "$HOME/.resend"
chmod 700 "$HOME/.resend"

# 600 before writing, so the key never exists under a permissive umask.
touch "$HOME/.resend/nuphos.env"
chmod 600 "$HOME/.resend/nuphos.env"

python3 - "$tmp" "$HOME/.resend/nuphos.env" <<'PY'
import json, shlex, sys
src, dst = sys.argv[1], sys.argv[2]
data = json.load(open(src))
with open(dst, "w") as f:
    api_key = (data.get("apiKey") or "").strip()
    if not api_key:
        raise SystemExit("Credentials response missing apiKey; re-bind the Resend integration.")
    f.write("unset RESEND_API_KEY\n")
    f.write(f"export RESEND_API_KEY={shlex.quote(api_key)}\n")
    f.write(f"export RESEND_API_BASE_URL={shlex.quote(str(data.get('apiBaseUrl') or 'https://api.resend.com'))}\n")
    f.write(f"export RESEND_PERMISSION={shlex.quote(str(data.get('permission') or ''))}\n")
    f.write(f"export RESEND_BINDING_ID={shlex.quote(str(data.get('bindingId', '')))}\n")
PY

chmod 600 "$HOME/.resend/nuphos.env"
echo "Wrote Resend credentials to ~/.resend/nuphos.env"
