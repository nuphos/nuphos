#!/usr/bin/env bash
set -euo pipefail
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
plan_id=${1:?usage: set-status.sh PLAN_ID STATUS}
status=${2:?usage: set-status.sh PLAN_ID STATUS}
case "$status" in
  executing|completed|failed|cancelled) ;;
  *) printf 'invalid agent-managed Plan status: %s\n' "$status" >&2; exit 2 ;;
esac
payload=$(jq -cn --arg status "$status" '{status:$status}')
exec bash "$script_dir/_request.sh" PATCH "/$plan_id" "$payload"
