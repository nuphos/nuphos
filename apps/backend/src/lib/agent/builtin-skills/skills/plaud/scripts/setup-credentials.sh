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
# On macOS the local sign-in keeps its token in the keychain; the CLI reads it.
if [ -z "$auth_token" ] && command -v nuphos >/dev/null 2>&1; then
  auth_token="$(nuphos auth token 2>/dev/null || true)"
fi
if [ -z "$auth_token" ]; then
  echo "NUPHOS_TOKEN is not set and there is no local Nuphos sign-in (run \`nuphos login\`)" >&2
  exit 1
fi

team_enc="$(urlencode "$team_id")"
binding_enc="$(urlencode "$binding_id")"
path="/teams/${team_enc}/plaud-accounts/${binding_enc}/credentials"

tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT

# Capture the HTTP status rather than -f so a 403 (not on the binding
# allow-list) vs 404 (binding deleted) — documented in SKILL.md — stay
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

mkdir -p "$HOME/.plaud"
chmod 700 "$HOME/.plaud"

python3 - "$tmp" "$HOME/.plaud/nuphos.env" <<'PY'
import json, shlex, sys
src, dst = sys.argv[1], sys.argv[2]
data = json.load(open(src))
token = (data.get("accessToken") or "").strip()
if not token:
    raise SystemExit("Credentials response missing accessToken; reconnect the Plaud account.")
values = {
    "PLAUD_ACCESS_TOKEN": token,
    "PLAUD_API_BASE_URL": data.get("apiBaseUrl") or "https://platform.plaud.ai/developer/api",
    "PLAUD_MCP_URL": data.get("mcpUrl") or "https://mcp.plaud.ai/mcp",
    "PLAUD_ACCOUNT_LABEL": data.get("label") or "",
    "PLAUD_BINDING_ID": data.get("bindingId") or "",
}
with open(dst, "w") as f:
    for key, value in values.items():
        f.write(f"export {key}={shlex.quote(str(value))}\n")
PY

chmod 600 "$HOME/.plaud/nuphos.env"
echo "Wrote Plaud credentials to ~/.plaud/nuphos.env"
