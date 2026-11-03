#!/usr/bin/env bash
set -euo pipefail

# --team uses the workspace's team (app) identity even when the turn's member
# connected a Personal Credential; their own Linear account is the default.
if [ "$#" -lt 2 ] || [ "$#" -gt 3 ] || { [ "$#" -eq 3 ] && [ "$3" != "--team" ]; }; then
  echo "Usage: setup-credentials.sh <teamId> <bindingId> [--team]" >&2
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
path="/teams/${team_enc}/linear-workspaces/${binding_enc}/credentials${3:+?identity=team}"

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

mkdir -p "$HOME/.linear"
chmod 700 "$HOME/.linear"

python3 - "$tmp" "$HOME/.linear/nuphos.env" "$team_id" <<'PY'
import json, shlex, sys
src, dst = sys.argv[1], sys.argv[2]
data = json.load(open(src))
with open(dst, "w") as f:
    token = (data.get("accessToken") or "").strip()
    if not token:
        raise SystemExit("Credentials response missing accessToken; re-bind the Linear workspace.")
    f.write("unset LINEAR_ACCESS_TOKEN\n")
    f.write(f"export LINEAR_ACCESS_TOKEN={shlex.quote(token)}\n")
    f.write(f"export LINEAR_NUPHOS_TEAM_ID={shlex.quote(sys.argv[3])}\n")
    f.write(f"export LINEAR_WORKSPACE_ID={shlex.quote(str(data.get('workspaceId', '')))}\n")
    f.write(f"export LINEAR_WORKSPACE_NAME={shlex.quote(str(data.get('workspaceName', '')))}\n")
    f.write(f"export LINEAR_ORG_URL_KEY={shlex.quote(str(data.get('organizationUrlKey') or ''))}\n")
    f.write(f"export LINEAR_BINDING_ID={shlex.quote(str(data.get('bindingId', '')))}\n")
actor = data.get("actor") or {}
print(f"Acting as {actor['login']} (Personal Credential)" if actor.get("kind") == "personal" else "Acting as the team's Linear app")
PY

chmod 600 "$HOME/.linear/nuphos.env"
echo "Wrote Linear credentials to ~/.linear/nuphos.env"
