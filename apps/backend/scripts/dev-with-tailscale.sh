#!/bin/sh
set -eu

# Local-only convenience wrapper. The bearer token protects the loopback
# control API for this process lifetime; it is not a database or Tailnet
# credential and intentionally does not need to be persisted.
DATABASE_TAILSCALE_DIALER_URL="${DATABASE_TAILSCALE_DIALER_URL:-http://127.0.0.1:4141}"
DATABASE_TAILSCALE_DIALER_TOKEN="${DATABASE_TAILSCALE_DIALER_TOKEN:-$(openssl rand -hex 32)}"
NUPHOS_TAILSCALE_DIALER_TOKEN="$DATABASE_TAILSCALE_DIALER_TOKEN"
case "$DATABASE_TAILSCALE_DIALER_URL" in
  http://127.0.0.1:*) ;;
  *)
    echo 'DATABASE_TAILSCALE_DIALER_URL must use http://127.0.0.1:<port>' >&2
    exit 1
    ;;
esac
NUPHOS_TAILSCALE_DIALER_ADDR="${DATABASE_TAILSCALE_DIALER_URL#http://}"
case "$NUPHOS_TAILSCALE_DIALER_ADDR" in
  */*|*\?*|*\#*)
    echo 'DATABASE_TAILSCALE_DIALER_URL must not include a path, query, or fragment' >&2
    exit 1
    ;;
esac
export DATABASE_TAILSCALE_DIALER_URL DATABASE_TAILSCALE_DIALER_TOKEN
export NUPHOS_TAILSCALE_DIALER_TOKEN NUPHOS_TAILSCALE_DIALER_ADDR

dialer_pid=''
backend_pid=''

cleanup() {
  trap - EXIT INT TERM HUP
  if [ -n "$backend_pid" ]; then kill "$backend_pid" 2>/dev/null || true; fi
  if [ -n "$dialer_pid" ]; then kill "$dialer_pid" 2>/dev/null || true; fi
  if [ -n "$backend_pid" ]; then wait "$backend_pid" 2>/dev/null || true; fi
  if [ -n "$dialer_pid" ]; then wait "$dialer_pid" 2>/dev/null || true; fi
}
trap cleanup EXIT INT TERM HUP

(cd ../tailscale-dialer && go run .) &
dialer_pid=$!
bun scripts/wait-for-tailscale-dialer.ts

bun run --hot src/index.ts &
backend_pid=$!
wait "$backend_pid"
