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
path="/teams/${team_enc}/upstash-accounts/${binding_enc}/credentials"

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
