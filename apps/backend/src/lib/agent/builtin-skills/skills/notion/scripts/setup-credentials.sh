#!/usr/bin/env bash
set -euo pipefail

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

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=../../_runtime/scripts/nuphos-token.sh
source "$script_dir/../../_runtime/scripts/nuphos-token.sh"
auth_token="$(nuphos_token)" || exit 1

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
  -H @<(printf 'Authorization: Bearer %s\n' "${auth_token}") \
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
