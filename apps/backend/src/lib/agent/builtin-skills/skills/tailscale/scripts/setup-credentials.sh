#!/usr/bin/env bash
set -euo pipefail
if [[ -n "${OPENAB_CREDENTIALS_DIR:-}" ]]; then
  NUPHOS_TOKEN=$(cat "$OPENAB_CREDENTIALS_DIR/NUPHOS_TOKEN" 2>/dev/null || true)
  export NUPHOS_TOKEN
fi

if [ "$#" -lt 2 ]; then
  cat >&2 <<'USAGE'
Usage: setup-credentials.sh <teamId> <clientId>

Fetches a short-lived Tailscale OAuth access token from Nuphos backend and
writes ~/.tailscale/nuphos.env for later Tailscale API calls.
USAGE
  exit 2
fi

team_id="$1"
client_id="$2"

if [ -z "${NUPHOS_TOKEN:-}" ]; then
  echo "NUPHOS_TOKEN is required" >&2
  exit 1
fi

if ! command -v python3 >/dev/null 2>&1; then
  echo "python3 is required to parse the credentials response" >&2
  exit 1
fi

base="${NUPHOS_BACKEND_URL:-https://api.nuphos.ai}"
base="${base%/}"
url="${base}/teams/${team_id}/tailscale-clients/${client_id}/credentials"

tmp="$(mktemp)"
cleanup() {
  rm -f "$tmp"
}
trap cleanup EXIT

status="$(curl -fsS -w '%{http_code}' -o "$tmp" \
  -H "Authorization: Bearer ${NUPHOS_TOKEN}" \
  "$url" || true)"

if [ "$status" != "200" ]; then
  echo "Credential request failed (HTTP ${status})" >&2
  cat "$tmp" >&2 || true
  exit 1
fi

mkdir -p "$HOME/.tailscale"
chmod 700 "$HOME/.tailscale"

python3 - "$tmp" "$HOME/.tailscale/nuphos.env" <<'PY'
import json
import shlex
import sys

src, dest = sys.argv[1], sys.argv[2]
with open(src, "r", encoding="utf-8") as f:
    data = json.load(f)

token = data.get("accessToken")
if not token:
    raise SystemExit("credentials response did not include accessToken")

tailnet = data.get("tailnet") or "-"
lines = [
    f"export TAILSCALE_API_TOKEN={shlex.quote(token)}",
    f"export TS_API_TOKEN={shlex.quote(token)}",
    f"export TAILSCALE_TAILNET={shlex.quote(tailnet)}",
    f"export TS_TAILNET={shlex.quote(tailnet)}",
    f"export TAILSCALE_CLIENT_ID={shlex.quote(data.get('clientId', ''))}",
    f"export TAILSCALE_CLIENT_LABEL={shlex.quote(data.get('label', ''))}",
    f"export TAILSCALE_TOKEN_EXPIRES_AT={shlex.quote(data.get('expiresAt', ''))}",
    "",
]
with open(dest, "w", encoding="utf-8") as f:
    f.write("\n".join(lines))
PY

chmod 600 "$HOME/.tailscale/nuphos.env"

echo "Wrote Tailscale credentials to ~/.tailscale/nuphos.env"
echo "Run: source ~/.tailscale/nuphos.env"
