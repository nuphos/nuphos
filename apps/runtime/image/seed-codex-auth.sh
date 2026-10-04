#!/bin/sh
set -eu
umask 077
: "${NUPHOS_AUTH_REVISION:?credential revision is unavailable}"
auth_directory=${NUPHOS_CODEX_AUTH_DIRECTORY:-/home/node/.codex}
auth_source=${NUPHOS_CODEX_AUTH_SOURCE:-/runtime-auth/auth.json}
mkdir -p "$auth_directory"
# A newly created runtime boots before the user completes device login.
if [ "$NUPHOS_AUTH_REVISION" = 'pending-login' ]; then exit 0; fi
previous_revision=$(cat "$auth_directory/.nuphos-auth-revision" 2>/dev/null || true)
# A refreshed auth.json belongs to the same binding. Never overwrite it on
# ordinary restarts; only a different bound credential resets the login.
if [ ! -s "$auth_directory/auth.json" ] || [ "$previous_revision" != "$NUPHOS_AUTH_REVISION" ]; then
  cp "$auth_source" "$auth_directory/auth.json.new"
  chmod 600 "$auth_directory/auth.json.new"
  # A concurrent reconciler may have updated the projected Secret. Only mark
  # the copied credential with its actual revision; retry mismatched snapshots.
  actual_revision=$(node -e 'const fs = require("node:fs"); const crypto = require("node:crypto"); process.stdout.write(crypto.createHash("sha256").update(fs.readFileSync(process.argv[1])).digest("hex").slice(0, 16))' "$auth_directory/auth.json.new")
  if [ "$actual_revision" != "$NUPHOS_AUTH_REVISION" ]; then
    rm -f "$auth_directory/auth.json.new"
    echo 'Codex credential revision changed during provisioning; retrying initialization.' >&2
    exit 1
  fi
  mv "$auth_directory/auth.json.new" "$auth_directory/auth.json"
  printf '%s' "$NUPHOS_AUTH_REVISION" > "$auth_directory/.nuphos-auth-revision"
fi
