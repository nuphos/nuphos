#!/usr/bin/env bash
set -euo pipefail
if [[ -n "${OPENAB_CREDENTIALS_DIR:-}" ]]; then
  NUPHOS_TOKEN=$(cat "$OPENAB_CREDENTIALS_DIR/NUPHOS_TOKEN" 2>/dev/null || true)
  export NUPHOS_TOKEN
fi

usage() {
  cat <<'EOF'
Usage:
  plan.sh get <planId> [teamId]           Fetch one plan (latest persisted state).
  plan.sh list [teamId]                   List recent plans in scope.
  plan.sh patch <planId> <json> [teamId]  Build/revise a proposed plan or update
                                          lifecycle/command progress. <json> is the
                                          PATCH body, e.g.
                                          '{"appendStep":{"title":"...","jobs":[...]}}'
                                          '{"status":"executing"}'
                                          '{"commandStatuses":[{"stepIdx":0,"jobIdx":0,"cmdIdx":0,"status":"done"}]}'

Pass the current team id whenever the conversation has one — without it the API
resolves personal scope and will not find team plans.

Environment:
  NUPHOS_BACKEND_URL  Defaults to https://api.nuphos.ai
  NUPHOS_TOKEN        Required; the current user's bearer token (exported in the sandbox).
EOF
}

if [ "$#" -lt 1 ] || [ "${1:-}" = "--help" ]; then
  usage
  exit 0
fi

: "${NUPHOS_TOKEN:?NUPHOS_TOKEN is not set}"
base="${NUPHOS_BACKEND_URL:-https://api.nuphos.ai}"

request() {
  local method="$1" path="$2" team="$3" body="${4:-}"
  local url="${base}${path}"
  if [ -n "$team" ]; then
    case "$url" in
      *\?*) url="${url}&teamId=${team}" ;;
      *) url="${url}?teamId=${team}" ;;
    esac
  fi
  local args=(-sS --connect-timeout 10 --max-time 60 -X "$method" -H "Authorization: Bearer $NUPHOS_TOKEN")
  if [ -n "$body" ]; then
    args+=(-H 'Content-Type: application/json' -d "$body")
  fi
  # curl exits 0 on HTTP 4xx/5xx, so a rejected PATCH would look like success
  # (callers do `plan.sh patch ... >/dev/null && echo ok`). Capture the status
  # and fail loudly: print the error body to stderr (visible even when stdout is
  # redirected) and return non-zero so `&& echo` can't report a phantom success.
  local response http_code out
  # A connect/DNS/TLS/timeout failure exits non-zero with no HTTP status; fail
  # loudly instead of falling through to the status check with an empty code.
  if ! response="$(curl "${args[@]}" -w $'\n%{http_code}' "$url")"; then
    printf 'plan.sh: %s %s request failed\n' "$method" "$path" >&2
    return 1
  fi
  http_code="${response##*$'\n'}"
  out="${response%$'\n'*}"
  if [ "${http_code:-0}" -ge 400 ] 2>/dev/null; then
    printf '%s\n' "$out" >&2
    printf 'plan.sh: %s %s failed (HTTP %s)\n' "$method" "$path" "$http_code" >&2
    return 1
  fi
  printf '%s\n' "$out"
}

cmd="$1"
shift
case "$cmd" in
  get)
    planId="${1:?usage: plan.sh get <planId> [teamId]}"
    request GET "/agent/plans/${planId}" "${2:-}"
    ;;
  list)
    request GET "/agent/plans" "${1:-}"
    ;;
  patch)
    planId="${1:?usage: plan.sh patch <planId> <json> [teamId]}"
    body="${2:?usage: plan.sh patch <planId> <json> [teamId]}"
    request PATCH "/agent/plans/${planId}" "${3:-}" "$body"
    ;;
  *)
    usage
    exit 1
    ;;
esac
