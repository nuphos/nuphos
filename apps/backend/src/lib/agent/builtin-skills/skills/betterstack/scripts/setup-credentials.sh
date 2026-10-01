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
integration_id="$2"
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
integration_enc="$(urlencode "$integration_id")"
path="/teams/${team_enc}/betterstack-integrations/${integration_enc}/credentials"

tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT

curl -fsSL \
  -H "Authorization: Bearer ${auth_token}" \
  -H "Accept: application/json" \
  "${base}${path}" > "$tmp"

mkdir -p "$HOME/.betterstack"
chmod 700 "$HOME/.betterstack"

python3 - "$tmp" "$HOME/.betterstack/nuphos.env" <<'PY'
import json, shlex, sys
src, dst = sys.argv[1], sys.argv[2]
data = json.load(open(src))
with open(dst, "w") as f:
    uptime = (data.get("uptimeApiToken") or "").strip()
    telemetry = (data.get("telemetryApiToken") or "").strip()
    f.write("unset BETTERSTACK_UPTIME_API_TOKEN\n")
    f.write("unset BETTERSTACK_TELEMETRY_API_TOKEN\n")
    f.write("unset BETTERSTACK_PROMETHEUS_WEBHOOK_URL\n")
    if uptime:
        f.write(f"export BETTERSTACK_UPTIME_API_TOKEN={shlex.quote(uptime)}\n")
    if telemetry:
        f.write(f"export BETTERSTACK_TELEMETRY_API_TOKEN={shlex.quote(telemetry)}\n")
    webhook = (data.get("prometheusWebhookUrl") or "").strip()
    if webhook:
        f.write(f"export BETTERSTACK_PROMETHEUS_WEBHOOK_URL={shlex.quote(webhook)}\n")
    integration_id = str(data.get("integrationId") or data.get("id") or "").strip()
    f.write(f"export BETTERSTACK_INTEGRATION_ID={shlex.quote(integration_id)}\n")
    f.write(f"export BETTERSTACK_LABEL={shlex.quote(str(data.get('label', '')))}\n")
PY

chmod 600 "$HOME/.betterstack/nuphos.env"
echo "Wrote Better Stack credentials to ~/.betterstack/nuphos.env"
