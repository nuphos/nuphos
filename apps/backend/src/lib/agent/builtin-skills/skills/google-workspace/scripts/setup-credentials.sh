#!/usr/bin/env bash
set -euo pipefail
if [[ -n "${OPENAB_CREDENTIALS_DIR:-}" ]]; then
  NUPHOS_TOKEN=$(cat "$OPENAB_CREDENTIALS_DIR/NUPHOS_TOKEN" 2>/dev/null || true)
  export NUPHOS_TOKEN
fi

if [ "$#" -ne 2 ] || { [ "$2" != "gmail" ] && [ "$2" != "google-drive" ]; }; then
  echo "Usage: setup-credentials.sh <teamId> <gmail|google-drive>" >&2
  exit 2
fi

team_id="$1"
provider="$2"
base="${NUPHOS_BACKEND_URL:-${NUPHOS_API_URL:-https://api.nuphos.ai}}"
base="${base%/}"

if [ -z "${NUPHOS_TOKEN:-}" ]; then
  echo "NUPHOS_TOKEN is not set; this handout only works inside a Nuphos agent conversation" >&2
  exit 1
fi

team_enc="$(python3 -c 'import sys, urllib.parse; print(urllib.parse.quote(sys.argv[1], safe=""))' "$team_id")"
path="/teams/${team_enc}/personal-credentials/${provider}/token"

tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT

status="$(curl -sSL -o "$tmp" -w '%{http_code}' \
  --connect-timeout 10 \
  --max-time 30 \
  --retry 3 \
  --retry-delay 1 \
  --retry-connrefused \
  -H @<(printf 'Authorization: Bearer %s\n' "${NUPHOS_TOKEN}") \
  -H "Accept: application/json" \
  "${base}${path}")"

if [ "$status" != "200" ]; then
  echo "Credential fetch failed with HTTP $status:" >&2
  cat "$tmp" >&2
  exit 1
fi

mkdir -p "$HOME/.google"
chmod 700 "$HOME/.google"
env_file="$HOME/.google/${provider}.env"
var="$( [ "$provider" = "gmail" ] && echo GMAIL || echo GOOGLE_DRIVE )"

python3 - "$tmp" "$env_file" "$var" <<'PY'
import json, shlex, sys
src, dst, var = sys.argv[1:4]
data = json.load(open(src))
token = (data.get("token") or "").strip()
if not token:
    raise SystemExit("Credentials response missing token; reconnect in Settings > Personal Credentials.")
with open(dst, "w") as f:
    f.write(f"export {var}_ACCESS_TOKEN={shlex.quote(token)}\n")
    f.write(f"export {var}_ACCOUNT={shlex.quote(data.get('login') or '')}\n")
PY

chmod 600 "$env_file"
echo "Acting as $(python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("login",""))' "$tmp") (Personal Credential)"
echo "Wrote ${provider} credentials to ~/.google/${provider}.env"
