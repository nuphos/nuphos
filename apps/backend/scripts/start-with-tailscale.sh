#!/bin/sh
set -eu

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

if [ -n "${DATABASE_TAILSCALE_DIALER_URL:-}" ]; then
  if [ -z "${DATABASE_TAILSCALE_DIALER_TOKEN:-}" ]; then
    echo 'DATABASE_TAILSCALE_DIALER_TOKEN is required when DATABASE_TAILSCALE_DIALER_URL is configured' >&2
    exit 1
  fi
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
  NUPHOS_TAILSCALE_DIALER_TOKEN="$DATABASE_TAILSCALE_DIALER_TOKEN"
  export NUPHOS_TAILSCALE_DIALER_TOKEN NUPHOS_TAILSCALE_DIALER_ADDR
  /usr/local/bin/nuphos-tailscale-dialer &
  dialer_pid=$!
  bun scripts/wait-for-tailscale-dialer.ts
fi

bun run src/index.ts &
backend_pid=$!
wait "$backend_pid"
