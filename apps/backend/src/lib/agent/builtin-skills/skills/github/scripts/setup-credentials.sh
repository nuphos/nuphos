#!/usr/bin/env bash
set -euo pipefail
if [[ -n "${OPENAB_CREDENTIALS_DIR:-}" ]]; then
  NUPHOS_TOKEN=$(cat "$OPENAB_CREDENTIALS_DIR/NUPHOS_TOKEN" 2>/dev/null || true)
  export NUPHOS_TOKEN
fi

usage() {
  cat >&2 <<EOF
Usage: setup-credentials.sh <teamId> <installationId|personal> [--for-commit] [--team]

  teamId          Nuphos team id (24-char hex)
  installationId  Numeric GitHub App installation id (from
                  GET /teams/<teamId>/github-installations), or \`personal\` for the
                  conversation owner's own GitHub account when this conversation
                  selected it (no team installation needed)

  --for-commit    Require and print the current Nuphos participant co-author trailer.
  --team          Use the team's App identity even when the turn's member connected
                  a Personal Credential (their own GitHub account is the default).

Environment:
  GH_CONFIG_DIR     Optional. Defaults to \$XDG_CONFIG_HOME/gh or \$HOME/.config/gh.
  GIT_CONFIG_GLOBAL Optional. Respected by git when supplied.
  NUPHOS_TOKEN       Required. Already exported in the Nuphos agent sandbox.
  NUPHOS_BACKEND_URL Required. Base URL of the Nuphos backend API; defaults to https://api.nuphos.ai.

Mints a fresh GitHub App installation token (≤1 h) and configures \`gh\`
auth so any subsequent tool call can run \`gh\` / \`gh api\` without
worrying about env vars. Installs \`gh\` first if it isn't on PATH.

For raw curl in another shell, retrieve the token with: \`gh auth token\`.
EOF
  exit 1
}

if [ "$#" -lt 2 ]; then usage; fi
for_commit=""
identity_query=""
for arg in "${@:3}"; do
  case "$arg" in
    --for-commit) for_commit=1 ;;
    --team) identity_query="?identity=team" ;;
    *) usage ;;
  esac
done

team_id="$1"
installation_id="$2"

if ! [[ "$team_id" =~ ^[0-9a-fA-F]{24}$ ]]; then
  echo "invalid teamId: expected a 24-char hex Nuphos team id, got '$team_id'" >&2
  exit 1
fi

if [ "$installation_id" = personal ]; then
  token_path="personal-credentials/github/token"
elif [[ "$installation_id" =~ ^[1-9][0-9]*$ ]]; then
  token_path="github-installations/$installation_id/token$identity_query"
else
  echo "invalid installationId: expected a numeric GitHub App installation id, got '$installation_id'" >&2
  exit 1
fi

if [ -z "${NUPHOS_TOKEN:-}" ]; then
  echo "NUPHOS_TOKEN is not set in this sandbox" >&2
  exit 1
fi


# Make sure `gh` exists; idempotent.
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if ! command -v gh >/dev/null 2>&1; then
  bash "$script_dir/install.sh"
  # install.sh's PATH export only lived in its own subshell; pick it up here
  # so the gh auth call below can find the binary in the fallback location.
  export PATH="$HOME/.local/bin:$PATH"
fi
if ! command -v gh >/dev/null 2>&1; then
  echo "gh is still not on PATH after install.sh; check installer output above." >&2
  exit 1
fi

team_get() {
  curl -fsSL \
    --connect-timeout 10 \
    --max-time 30 \
    --retry 2 \
    --retry-delay 1 \
    --retry-all-errors \
    -H @<(printf 'Authorization: Bearer %s\n' "$NUPHOS_TOKEN") \
    "${NUPHOS_BACKEND_URL:-https://api.nuphos.ai}/teams/$team_id/$1"
}

token_response="$(team_get "$token_path")"

token="$(printf '%s' "$token_response" | python3 -c '
import json, sys
data = json.load(sys.stdin)
print(data["token"])
')"
expires_at="$(printf '%s' "$token_response" | python3 -c '
import json, sys
data = json.load(sys.stdin)
print(data.get("expiresAt", ""))
')"
account_login="$(printf '%s' "$token_response" | python3 -c '
import json, sys
data = json.load(sys.stdin)
print(data.get("accountLogin", ""))
')"
acting_as="$(printf '%s' "$token_response" | python3 -c '
import json, sys
actor = json.load(sys.stdin).get("actor") or {}
print(actor.get("login", "") + " through the team GitHub App, limited to its permissions" if actor.get("kind") == "personal" else "the team App")
')"

if [ -z "$token" ]; then
  echo "Nuphos backend returned no token" >&2
  exit 1
fi

# Even gh auth login --insecure-storage can change the shared keychain's active
# token. Write the session config directly; never invoke the login/switch flow.
umask 077
export GH_CONFIG_DIR="${GH_CONFIG_DIR:-${XDG_CONFIG_HOME:-$HOME/.config}/gh}"
mkdir -p "$GH_CONFIG_DIR"
chmod 700 "$GH_CONFIG_DIR"
printf '%s' "$token_response" | python3 "$script_dir/write-auth.py" "$GH_CONFIG_DIR"

# Wire up git's credential helper so `gh repo clone` and plain `git push`
# authenticate without the agent putting the token into command-line URLs.
gh auth setup-git --hostname github.com

echo "GitHub installation token loaded for $account_login (installation $installation_id), acting as $acting_as"
echo "Expires at: $expires_at"

# Every identity here goes through the GitHub App, so its installation decides
# what a call may do. Print that now: a later "Resource not accessible by
# integration" then names a gap the reader can already see. Best effort only.
if [ "$acting_as" = "the team App" ]; then
  team_get "github-installations/$installation_id" 2>/dev/null
else
  gh api '/user/installations?per_page=100' 2>/dev/null
fi | python3 -c '
import json, sys
want = sys.argv[1]
data = json.load(sys.stdin)
for inst in data.get("installations", [data]):
    inst_id = str(inst.get("id", inst.get("installationId")))
    if want not in ("personal", inst_id):
        continue
    login = (inst.get("account") or {}).get("login") or inst.get("accountLogin")
    org = (inst.get("target_type") or inst.get("accountType")) == "Organization"
    owner_path = f"organizations/{login}/" if org else ""
    granted = ", ".join(f"{k}={v}" for k, v in sorted((inst.get("permissions") or {}).items()))
    print(f"App permissions on {login}: {granted or None}")
    print(f"  Installation settings: https://github.com/{owner_path}settings/installations/{inst_id}")
' "$installation_id" 2>/dev/null || true
echo
echo "Use \`gh ...\` or \`gh api /repos/...\` directly. \`gh repo clone owner/repo\` and \`git push\` also work."
echo "Re-run this script if you get 401."

# Refresh this identity before each commit; shared conversations can change actors.
if [ -n "$for_commit" ]; then
  printf '%s' "$token_response" | python3 -c '
import json, re, sys
author = json.load(sys.stdin).get("commitCoAuthor") or {}
name, email = author.get("name"), author.get("email")
if not isinstance(name, str) or not name.strip() or re.search(r"[\x00-\x1f\x7f<>]", name):
    sys.exit("Missing or invalid Nuphos participant name; stop before committing")
if not isinstance(email, str) or not re.fullmatch(r"[^\s<>@\x00-\x1f\x7f]+@[^\s<>@\x00-\x1f\x7f]+", email):
    sys.exit("Missing or invalid Nuphos participant email; stop before committing")
print(f"Co-authored-by: {name.strip()} <{email}>")
'
fi
