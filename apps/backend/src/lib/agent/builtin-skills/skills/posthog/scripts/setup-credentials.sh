#!/usr/bin/env bash
set -euo pipefail
if [[ -n "${OPENAB_CREDENTIALS_DIR:-}" ]]; then
  NUPHOS_TOKEN=$(cat "$OPENAB_CREDENTIALS_DIR/NUPHOS_TOKEN" 2>/dev/null || true)
  export NUPHOS_TOKEN
fi

if [ "$#" -ne 2 ]; then
  echo "Usage: setup-credentials.sh <teamId> <integrationId>" >&2
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
path="/teams/${team_enc}/posthog-integrations/${binding_enc}/credentials"

tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT

# Not -f: SKILL.md tells a 403 (not selected / not allow-listed) from a 404.
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

mkdir -p "$HOME/.posthog"
chmod 700 "$HOME/.posthog"

python3 - "$tmp" "$HOME/.posthog/nuphos.env" <<'PY'
import json, os, shlex, sys
src, dst = sys.argv[1], sys.argv[2]
data = json.load(open(src))
token = (data.get("accessToken") or "").strip()
host = (data.get("apiBaseUrl") or "").strip().rstrip("/")
if not token or not host:
    raise SystemExit("Credentials response missing accessToken or apiBaseUrl; reconnect PostHog.")
project_ids = [str(p["id"]) for p in data.get("projects") or [] if isinstance(p.get("id"), int)]
if not project_ids:
    raise SystemExit("This PostHog integration has no projects selected; ask a team admin to pick one.")
lines = {
    "POSTHOG_HOST": host,
    "POSTHOG_ACCESS_TOKEN": token,
    "POSTHOG_TOKEN_EXPIRES_AT": str(data.get("expiresAt") or ""),
    "POSTHOG_SCOPES": str(data.get("scope") or ""),
    "POSTHOG_PROJECT_ID": project_ids[0],
    "POSTHOG_PROJECT_IDS": ",".join(project_ids),
    "POSTHOG_BINDING_ID": str(data.get("bindingId") or ""),
}
fd = os.open(dst, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
with os.fdopen(fd, "w") as f:
    for key, value in lines.items():
        f.write(f"export {key}={shlex.quote(value)}\n")
print(f"  scopes: {data.get('scope') or '(none)'}")
for p in data.get("projects") or []:
    print(f"  project {p.get('id')}: {p.get('name')} ({p.get('organizationName') or 'unknown org'})")
PY

chmod 600 "$HOME/.posthog/nuphos.env"
echo "Wrote PostHog credentials to ~/.posthog/nuphos.env"
