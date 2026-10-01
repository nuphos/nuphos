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
path="/teams/${team_enc}/notion-integrations/${binding_enc}/credentials"

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

mkdir -p "$HOME/.notion"
chmod 700 "$HOME/.notion"

# 600 before writing, so the token never exists under a permissive umask.
touch "$HOME/.notion/nuphos.env"
chmod 600 "$HOME/.notion/nuphos.env"

python3 - "$tmp" "$HOME/.notion/nuphos.env" <<'PY'
import json, shlex, sys
src, dst = sys.argv[1], sys.argv[2]
data = json.load(open(src))
with open(dst, "w") as f:
    token = (data.get("accessToken") or "").strip()
    if not token:
        raise SystemExit("Credentials response missing accessToken; re-bind the Notion integration.")
    f.write("unset NOTION_TOKEN\n")
    f.write(f"export NOTION_TOKEN={shlex.quote(token)}\n")
    f.write(f"export NOTION_VERSION={shlex.quote(str(data.get('notionVersion') or '2026-03-11'))}\n")
    f.write(f"export NOTION_WORKSPACE_NAME={shlex.quote(str(data.get('workspaceName') or ''))}\n")
    f.write(f"export NOTION_BINDING_ID={shlex.quote(str(data.get('bindingId', '')))}\n")
PY

chmod 600 "$HOME/.notion/nuphos.env"
echo "Wrote Notion credentials to ~/.notion/nuphos.env"
