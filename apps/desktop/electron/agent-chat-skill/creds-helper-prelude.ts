export const SHORT_LIVED_CREDS_HELPER_PRELUDE = `#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat >&2 <<'EOF'
Usage:
  get-short-lived-creds-from-nuphos list teams
  get-short-lived-creds-from-nuphos list aws-accounts --team-id <teamId>
  get-short-lived-creds-from-nuphos list gcp-projects --team-id <teamId>
  get-short-lived-creds-from-nuphos list aws-clusters --team-id <teamId> --account-id <accountId> [--role-id <roleId>]
  get-short-lived-creds-from-nuphos list gcp-clusters --team-id <teamId> --project-id <projectId> [--service-account-id <id>]
  get-short-lived-creds-from-nuphos aws --team-id <teamId> --account-id <accountId> [--region us-east-1] [--role-id <roleId>] [--format files|env]
  get-short-lived-creds-from-nuphos gcp --team-id <teamId> --project-id <projectId> [--service-account-id <id>] [--format files|env]
  get-short-lived-creds-from-nuphos k8s --team-id <teamId> --provider aws --account-id <accountId> --cluster <name> [--region <region>] [--output ~/.kube/config]
  get-short-lived-creds-from-nuphos k8s --team-id <teamId> --provider gcp --project-id <projectId> --cluster <name> [--location <location>] [--output ~/.kube/config]

Optional env:
  NUPHOS_TOKEN (fallback when ~/.config/nuphos/cli.yaml is unavailable)
  NUPHOS_BACKEND_URL or NUPHOS_API_URL (defaults to https://api.nuphos.ai)
  NUPHOS_SESSION_ID (uses agent-session scoped endpoints when present)
EOF
  exit 1
}

if [ "$#" -lt 1 ]; then usage; fi
kind="$1"
shift
list_target=""
if [ "$kind" = "list" ]; then
  list_target="\${1:-}"
  if [ -z "$list_target" ]; then usage; fi
  shift
fi

team_id=""
account_id=""
project_id=""
provider=""
cluster=""
region=""
location=""
role_id=""
service_account_id=""
format="files"
output_path=""

while [ "$#" -gt 0 ]; do
  case "$1" in
    --team-id|--teamId)
      team_id="$2"; shift 2 ;;
    --account-id|--accountId)
      account_id="$2"; shift 2 ;;
    --project-id|--projectId)
      project_id="$2"; shift 2 ;;
    --provider)
      provider="$2"; shift 2 ;;
    --cluster|--cluster-name|--clusterName)
      cluster="$2"; shift 2 ;;
    --region)
      region="$2"; shift 2 ;;
    --location)
      location="$2"; shift 2 ;;
    --role-id|--roleId)
      role_id="$2"; shift 2 ;;
    --service-account-id|--serviceAccountId)
      service_account_id="$2"; shift 2 ;;
    --format)
      format="$2"; shift 2 ;;
    --output)
      output_path="$2"; shift 2 ;;
    *)
      echo "unknown argument: $1" >&2
      usage ;;
  esac
done

if ! command -v curl >/dev/null 2>&1; then
  echo "curl is required" >&2
  exit 1
fi
if ! command -v python3 >/dev/null 2>&1; then
  echo "python3 is required to parse credentials responses" >&2
  exit 1
fi
if [ "$format" != "files" ] && [ "$format" != "env" ]; then
  echo "--format must be files or env" >&2
  exit 1
fi

read_local_nuphos_token() {
  python3 - <<'PY'
import re
from pathlib import Path

for path in (
    Path.home() / ".config" / "nuphos" / "cli.yaml",
    Path.home() / ".config" / "nuphos" / "config.yaml",
):
    try:
        text = path.read_text()
    except OSError:
        continue
    match = re.search(r'(?m)^token:\\s*(.+?)\\s*$', text)
    if not match:
        continue
    token = match.group(1).strip()
    if (token.startswith('"') and token.endswith('"')) or (token.startswith("'") and token.endswith("'")):
        token = token[1:-1]
    if token:
        print(token)
        raise SystemExit(0)
raise SystemExit(1)
PY
}

auth_token="\${NUPHOS_TOKEN:-}"
if [ -z "$auth_token" ]; then
  auth_token="$(read_local_nuphos_token || true)"
fi
if [ -z "$auth_token" ]; then
  echo "Nuphos is not signed in. Open Nuphos and sign in, then retry." >&2
  echo "Expected local auth at ~/.config/nuphos/cli.yaml. NUPHOS_TOKEN can be used as a fallback." >&2
  exit 1
fi

base="\${NUPHOS_BACKEND_URL:-\${NUPHOS_API_URL:-https://api.nuphos.ai}}"
base="\${base%/}"

urlencode() {
  python3 -c 'import sys, urllib.parse; print(urllib.parse.quote(sys.argv[1], safe=""))' "$1"
}

fetch() {
  local url="$1"
  local accept="$2"
  local tmp="$3"
  local http_code curl_status
  for attempt in 1 2 3; do
    : > "$tmp"
    set +e
    http_code="$(curl --http1.1 -sS -o "$tmp" -w '%{http_code}' \
      --connect-timeout 10 \
      --max-time 30 \
      -H "Authorization: Bearer \${auth_token}" \
      -H "Accept: \${accept}" \
      "$url")"
    curl_status=$?
    set -e
    if [ "$curl_status" -eq 0 ]; then
      break
    fi
    if [ "$attempt" -eq 3 ]; then
      echo "Nuphos request failed after 3 attempts (curl exit \${curl_status})" >&2
      exit "$curl_status"
    fi
    sleep "$attempt"
  done
  if [ "$http_code" != "200" ]; then
    echo "Nuphos returned HTTP \${http_code} for \${url}:" >&2
    cat "$tmp" >&2
    echo >&2
    exit 1
  fi
}

agent_or_team_path() {
  local team_path="$1"
  if [ -n "\${NUPHOS_SESSION_ID:-}" ]; then
    printf '/agent-sessions/%s%s' "$(urlencode "$NUPHOS_SESSION_ID")" "$team_path"
  else
    printf '%s' "$team_path"
  fi
}

print_json() {
  python3 -m json.tool "$1" 2>/dev/null || cat "$1"
}

`
