#!/usr/bin/env bash
set -euo pipefail
if [[ -n "${OPENAB_CREDENTIALS_DIR:-}" ]]; then
  NUPHOS_TOKEN=$(cat "$OPENAB_CREDENTIALS_DIR/NUPHOS_TOKEN" 2>/dev/null || true)
  export NUPHOS_TOKEN
fi

usage() {
  cat >&2 <<EOF
Usage: setup-credentials.sh <teamId> <bindingId>

  teamId     Nuphos team id (24-char hex)
  bindingId  GitLab binding id (24-char hex, from
             GET /teams/<teamId>/gitlab-bindings)

Environment:
  NUPHOS_TOKEN       Required. Already exported in the Nuphos agent sandbox.
  NUPHOS_BACKEND_URL Required. Base URL of the Nuphos backend API; defaults to https://api.nuphos.ai.

Fetches the binding's short-lived (~2 h, backend-auto-refreshed)
GitLab OAuth access token and wires up git, glab, and curl access:

  - git credential store for the binding's host, so \`git clone <https url>\`
    works without putting the token on the command line
  - ~/.gitlab-token + ~/.gitlab-host (mode 600) for direct API calls:
      curl -H "Authorization: Bearer \$(cat ~/.gitlab-token)" \\
        "\$(cat ~/.gitlab-host)/api/v4/projects?membership=true"
  - glab authentication when the runtime provides the GitLab CLI

Re-run on 401 — the token expires after ~2 hours.
EOF
  exit 1
}

if [ "$#" -lt 2 ]; then usage; fi

team_id="$1"
binding_id="$2"

if ! [[ "$team_id" =~ ^[0-9a-fA-F]{24}$ ]]; then
  echo "invalid teamId: expected a 24-char hex Nuphos team id, got '$team_id'" >&2
  exit 1
fi

if ! [[ "$binding_id" =~ ^[0-9a-fA-F]{24}$ ]]; then
  echo "invalid bindingId: expected a 24-char hex GitLab binding id, got '$binding_id'" >&2
  exit 1
fi

if [ -z "${NUPHOS_TOKEN:-}" ]; then
  echo "NUPHOS_TOKEN is not set in this sandbox" >&2
  exit 1
fi

token_response="$(curl -fsSL \
  --connect-timeout 10 \
  --max-time 30 \
  --retry 2 \
  --retry-delay 1 \
  --retry-all-errors \
  -H "Authorization: Bearer $NUPHOS_TOKEN" \
  "${NUPHOS_BACKEND_URL:-https://api.nuphos.ai}/teams/$team_id/gitlab-bindings/$binding_id/token")"

token="$(printf '%s' "$token_response" | python3 -c '
import json, sys
data = json.load(sys.stdin)
print(data["token"])
')"
host_url="$(printf '%s' "$token_response" | python3 -c '
import json, sys
data = json.load(sys.stdin)
print(data["hostUrl"])
')"
expires_at="$(printf '%s' "$token_response" | python3 -c '
import json, sys
data = json.load(sys.stdin)
print(data.get("expiresAt", ""))
')"
username="$(printf '%s' "$token_response" | python3 -c '
import json, sys
data = json.load(sys.stdin)
print(data.get("username", ""))
')"
scope="$(printf '%s' "$token_response" | python3 -c '
import json, sys
data = json.load(sys.stdin)
print(data.get("scope", ""))
')"

if [ -z "$token" ] || [ -z "$host_url" ]; then
  echo "Nuphos backend returned no token" >&2
  exit 1
fi

host_no_scheme="${host_url#https://}"
host_no_scheme="${host_no_scheme#http://}"

# Persist for direct API calls from any later shell (shell-independent, like
# gh's hosts.yml in the github skill).
umask 077
printf '%s' "$token" > "$HOME/.gitlab-token"
printf '%s' "$host_url" > "$HOME/.gitlab-host"
# umask only governs newly created files; re-harden in case earlier runs (or
# another tool) left these with wider permissions.
chmod 600 "$HOME/.gitlab-token" "$HOME/.gitlab-host"

# Wire up git so HTTPS clone/fetch authenticate without the token appearing
# in command lines or remotes. GitLab accepts OAuth tokens over HTTPS with
# the literal username "oauth2".
git config --global credential.helper store
touch "$HOME/.git-credentials"
# Drop any previous entry for this host before appending the fresh token.
grep -v "@$host_no_scheme$" "$HOME/.git-credentials" > "$HOME/.git-credentials.tmp" || true
mv "$HOME/.git-credentials.tmp" "$HOME/.git-credentials"
chmod 600 "$HOME/.git-credentials"
printf 'https://oauth2:%s@%s\n' "$token" "$host_no_scheme" >> "$HOME/.git-credentials"

# Configure the official CLI without putting the token in process arguments.
# This stays conditional while production converges on the image with glab;
# curl + git remain a complete fallback on older images.
if command -v glab >/dev/null 2>&1; then
  protocol="${host_url%%://*}"
  hostname="${host_no_scheme%%/*}"
  printf '%s' "$token" | glab auth login \
    --hostname "$hostname" \
    --api-protocol "$protocol" \
    --git-protocol https \
    --stdin \
    --insecure-storage >/dev/null
fi

echo "GitLab access token loaded for @$username on $host_url"
echo "Scope: ${scope:-unknown}"
echo "Expires at: ${expires_at:-unknown} (re-run this script on 401)"
echo
if ! printf ' %s ' "$scope" | grep -q ' api '; then
  echo "Warning: this GitLab binding does not include the 'api' scope."
  echo "Opening MRs or posting MR comments will fail until a team admin reconnects GitLab."
fi
if ! printf ' %s ' "$scope" | grep -q ' write_repository '; then
  echo "Warning: this GitLab binding does not include the 'write_repository' scope."
  echo "Pushing branches will fail until a team admin reconnects GitLab."
fi
echo
echo "git clone $host_url/<group>/<project>.git now works directly."
if command -v glab >/dev/null 2>&1; then
  echo "GitLab CLI: glab repo list --member --output json"
fi
echo "API: curl -H \"Authorization: Bearer \$(cat ~/.gitlab-token)\" \"$host_url/api/v4/projects?membership=true\""
