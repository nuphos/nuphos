# Sourced, not executed: the one place builtin skill scripts get their Nuphos
# token from.
#
#   script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
#   source "$script_dir/../../_runtime/scripts/nuphos-token.sh"
#   auth_token="$(nuphos_token)" || exit 1
#
# Lookup order:
#   1. $OPENAB_CREDENTIALS_DIR/NUPHOS_TOKEN, the conversation token the runtime
#      renews during a turn. When the directory is set it is the only source, so
#      a revoked token is never replaced by the NUPHOS_TOKEN the process was
#      spawned with.
#   2. NUPHOS_TOKEN.
#
# It never reads ~/.config/nuphos/*.yaml: that file holds the account's full
# session token, which scripts must not use.

nuphos_token() {
  local token=""

  if [[ -n "${OPENAB_CREDENTIALS_DIR:-}" ]]; then
    token=$(cat "$OPENAB_CREDENTIALS_DIR/NUPHOS_TOKEN" 2>/dev/null || true)
  else
    token="${NUPHOS_TOKEN:-}"
  fi

  if [[ -z "$token" ]]; then
    echo "Nuphos authorization is unavailable: run this from a Nuphos agent conversation, which provides a short-lived NUPHOS_TOKEN." >&2
    return 1
  fi

  printf '%s\n' "$token"
}
