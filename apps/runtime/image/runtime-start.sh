#!/bin/sh
# The image's entrypoint. Prepares what a self-hosted container cannot be handed by a
# provisioner, then becomes the command it was given — openab, by default.
set -eu

min_password_length=32

fail() {
  printf 'nuphos-runtime-start: %s\n' "$1" >&2
  exit 1
}

check_password() {
  [ "${#OPENAB_ACP_AUTH_KEY}" -ge "$min_password_length" ] \
    || fail "the runtime password from $1 is ${#OPENAB_ACP_AUTH_KEY} characters; it must be at least $min_password_length. \`openssl rand -hex 32\` makes one that fits."
}

generate_password() {
  key_dir=$(dirname "$key_file")
  # Besides the password itself, the traces an earlier boot leaves on this home. A
  # custom key file may sit in a directory the runtime does not own.
  had_identity=
  if { [ "$key_file" = "$default_key_file" ] && [ -d "$key_dir" ]; } \
    || { [ -n "${OPENAB_RUNTIME_AUTH_FILE:-}" ] && [ -e "$OPENAB_RUNTIME_AUTH_FILE" ]; }; then
    had_identity=1
  fi

  if [ ! -d "$key_dir" ]; then
    (umask 077 && mkdir -p "$key_dir") \
      || fail "cannot create $key_dir to store the runtime password; set OPENAB_ACP_AUTH_KEY or make it writable."
  fi
  OPENAB_ACP_AUTH_KEY=$(node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("hex"))')
  tmp=$(umask 077 && mktemp "$key_dir/.auth-key.XXXXXX") \
    || fail "cannot write the runtime password to $key_dir."
  { printf '%s\n' "$OPENAB_ACP_AUTH_KEY" > "$tmp" && chmod 600 "$tmp" && mv -f "$tmp" "$key_file"; } \
    || { rm -f "$tmp"; fail "cannot write the runtime password to $key_file."; }

  if [ -n "$had_identity" ]; then
    printf 'WARNING: no runtime password was found at %s, but this home has run a runtime before. A new password was generated: update it in every Nuphos workspace this runtime is connected to.\n' "$key_file"
  fi
  printf 'Generated runtime password (stored in %s): %s — enter it in Nuphos when connecting this runtime. Unless %s is on a persistent volume, the password changes on every restart.\n' \
    "$key_file" "$OPENAB_ACP_AUTH_KEY" "$key_file"
}

enabled() {
  [ "${1:-}" = true ] || [ "${1:-}" = 1 ]
}

# One set in the environment wins. With the runtime console on, openab owns the home
# volume's credentials: it imports a password file left by an earlier version and
# otherwise serves a setup page, so nothing is generated unless
# NUPHOS_RUNTIME_AUTOGEN_PASSWORD asks for the old behaviour. With the console off, the
# runtime keeps its own password on the home volume, generated on first boot.
if enabled "${OPENAB_ACP_ENABLED:-}"; then
  default_key_file=/home/node/.nuphos-runtime/auth-key
  key_file=${OPENAB_ACP_AUTH_KEY_FILE:-$default_key_file}
  if [ -n "${OPENAB_ACP_AUTH_KEY:-}" ]; then
    check_password OPENAB_ACP_AUTH_KEY
    export OPENAB_ACP_AUTH_KEY
  elif enabled "${OPENAB_RUNTIME_CONSOLE:-}"; then
    export OPENAB_RUNTIME_LEGACY_KEY_FILE="$key_file"
    if [ -e "$key_file" ]; then
      OPENAB_ACP_AUTH_KEY=$(tr -d '\r\n' < "$key_file") \
        || fail "cannot read the runtime password from $key_file."
      check_password "$key_file"
      unset OPENAB_ACP_AUTH_KEY
    elif enabled "${NUPHOS_RUNTIME_AUTOGEN_PASSWORD:-}"; then
      generate_password
      unset OPENAB_ACP_AUTH_KEY
    else
      printf 'Open this runtime'"'"'s address in a browser to set its console password. Setup stays open for %s minutes after each start.\n' \
        "$(( ${OPENAB_RUNTIME_SETUP_WINDOW_SECS:-1800} / 60 ))"
    fi
  else
    if [ -e "$key_file" ]; then
      OPENAB_ACP_AUTH_KEY=$(tr -d '\r\n' < "$key_file") \
        || fail "cannot read the runtime password from $key_file."
      check_password "$key_file"
      printf 'Using the runtime password from %s.\n' "$key_file"
    else
      generate_password
    fi
    export OPENAB_ACP_AUTH_KEY
  fi
fi

# Derive the operator key from the password unless one was set. Must match
# `deriveRuntimeControlKey` in the Nuphos backend. A value equal to the password is
# replaced too, because openab discards an operator key equal to the transport key.
if [ -n "${OPENAB_ACP_AUTH_KEY:-}" ]; then
  if [ -z "${OPENAB_ACP_CONTROL_KEY:-}" ] || [ "$OPENAB_ACP_CONTROL_KEY" = "$OPENAB_ACP_AUTH_KEY" ]; then
    # The password reaches node through the environment, never argv, which is
    # readable by anything in the container through /proc.
    OPENAB_ACP_CONTROL_KEY=$(node -e '
      const { createHmac } = require("node:crypto");
      process.stdout.write(
        createHmac("sha256", process.env.OPENAB_ACP_AUTH_KEY)
          .update("nuphos-runtime-control-v1")
          .digest("hex"),
      );
    ')
    export OPENAB_ACP_CONTROL_KEY
  fi
fi

# A token in the environment outranks any stored login, so a sign-in would change
# nothing and the credential file says nothing about the account in use.
if [ -n "${CLAUDE_CODE_OAUTH_TOKEN:-}" ]; then
  export OPENAB_RUNTIME_LOGIN_COMMAND= OPENAB_RUNTIME_AUTH_FILE=
fi

# The workspace layout a provisioned pod's init container builds, so a self-hosted
# runtime's skills land where each agent reads them. Idempotent, and never fatal: a
# workspace that is not writable still lets the runtime chat.
workspace=${NUPHOS_RUNTIME_WORKSPACE:-/workspace}
if mkdir -p "$workspace/.claude" 2>/dev/null; then
  [ -e "$workspace/skills" ] || ln -s .claude/skills "$workspace/skills" 2>/dev/null || true
  # Codex reads its own path. A symlink rather than a second copy, because it
  # deduplicates skills by absolute path and two real copies would double every
  # entry's context cost.
  if mkdir -p "$workspace/.agents" 2>/dev/null; then
    [ -e "$workspace/.agents/skills" ] || ln -s ../.claude/skills "$workspace/.agents/skills" 2>/dev/null || true
  fi
fi

if [ "$#" -eq 0 ]; then
  set -- openab run -c /etc/openab/config.toml
fi
exec "$@"
