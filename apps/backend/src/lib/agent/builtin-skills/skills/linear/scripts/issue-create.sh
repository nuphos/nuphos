#!/usr/bin/env bash
set -euo pipefail

team_id=""
title=""
assignee_id=""
state_id=""
priority=""
description_file="-"
env_path="${LINEAR_ENV_PATH:-$HOME/.linear/nuphos.env}"

usage() {
  cat >&2 <<'EOF'
Usage: issue-create.sh --team ID --title TITLE [--assignee ID] [--state ID] [--priority 0-4] [--description-file PATH]

The issue description is read from stdin unless --description-file is given.
EOF
  exit 2
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --team) [ "$#" -ge 2 ] || usage; team_id="$2"; shift 2 ;;
    --title) [ "$#" -ge 2 ] || usage; title="$2"; shift 2 ;;
    --assignee) [ "$#" -ge 2 ] || usage; assignee_id="$2"; shift 2 ;;
    --state) [ "$#" -ge 2 ] || usage; state_id="$2"; shift 2 ;;
    --priority) [ "$#" -ge 2 ] || usage; priority="$2"; shift 2 ;;
    --description-file) [ "$#" -ge 2 ] || usage; description_file="$2"; shift 2 ;;
    *) usage ;;
  esac
done

[ -n "$team_id" ] || usage
[ -n "$title" ] || usage
if [ "$description_file" != "-" ] && [ ! -r "$description_file" ]; then
  echo "Issue description is not readable: $description_file" >&2
  exit 2
fi
if [ -n "$priority" ] && [[ ! "$priority" =~ ^[0-4]$ ]]; then
  echo "Linear priority must be an integer from 0 through 4." >&2
  exit 2
fi

if [ -r "$env_path" ]; then
  # setup-credentials.sh owns this mode-0600 file. The GraphQL helper sources
  # it again independently; this read is for the Nuphos team id used in links.
  # shellcheck disable=SC1090
  source "$env_path"
fi
nuphos_team_id="${LINEAR_NUPHOS_TEAM_ID:-}"
nuphos_session_id="${NUPHOS_SESSION_ID:-}"

script_dir="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
payload="$(mktemp)"
response="$(mktemp)"
description_tmp="$(mktemp)"
attachment_payload="$(mktemp)"
attachment_response="$(mktemp)"
trap 'rm -f "$payload" "$response" "$description_tmp" "$attachment_payload" "$attachment_response"' EXIT

if [ "$description_file" = "-" ]; then
  cat > "$description_tmp"
  description_file="$description_tmp"
fi

python3 - "$payload" "$description_file" "$team_id" "$title" "$assignee_id" "$state_id" "$priority" <<'PY'
import json
import sys

(
    payload_path,
    description_path,
    team_id,
    title,
    assignee_id,
    state_id,
    priority,
) = sys.argv[1:]
with open(description_path) as src:
    description = src.read()

issue_input = {"teamId": team_id, "title": title}
if description.strip():
    issue_input["description"] = description
if assignee_id:
    issue_input["assigneeId"] = assignee_id
if state_id:
    issue_input["stateId"] = state_id
if priority:
    issue_input["priority"] = int(priority)

query = """mutation CreateIssue($input: IssueCreateInput!) {
  issueCreate(input: $input) {
    success
    issue {
      id
      identifier
      title
      url
      priority
      state { id name type }
      assignee { id name displayName email }
      team { id key name }
    }
  }
}"""

with open(payload_path, "w") as dst:
    json.dump({"query": query, "variables": {"input": issue_input}}, dst)
PY

bash "$script_dir/graphql.sh" "$payload" > "$response"

issue_id="$(python3 - "$response" <<'PY'
import json
import sys

with open(sys.argv[1]) as src:
    result = json.load(src)["data"]["issueCreate"]

if not result.get("success") or not result.get("issue"):
    print(json.dumps(result, ensure_ascii=False, indent=2), file=sys.stderr)
    raise SystemExit(1)

print(result["issue"]["id"])
PY
)"

if [ -n "$nuphos_team_id" ] && [ -n "$nuphos_session_id" ]; then
  session_url="https://nuphos.ai/teams/${nuphos_team_id}/agent/${nuphos_session_id}"
  python3 - "$attachment_payload" "$issue_id" "$session_url" "$nuphos_session_id" <<'PY'
import json
import sys

payload_path, issue_id, session_url, session_id = sys.argv[1:]
query = """mutation CreateAttachment($input: AttachmentCreateInput!) {
  attachmentCreate(input: $input) {
    success
    attachment { id title subtitle url }
  }
}"""
attachment_input = {
    "issueId": issue_id,
    "title": "Nuphos session",
    "subtitle": "Source context",
    "url": session_url,
    "metadata": {"nuphosSessionId": session_id},
}
with open(payload_path, "w") as dst:
    json.dump({"query": query, "variables": {"input": attachment_input}}, dst)
PY

  if ! bash "$script_dir/graphql.sh" "$attachment_payload" > "$attachment_response"; then
    python3 - "$response" "$session_url" <<'PY'
import json
import sys

with open(sys.argv[1]) as src:
    issue = json.load(src)["data"]["issueCreate"]["issue"]
issue["sourceLink"] = {"success": False, "url": sys.argv[2]}
print(json.dumps(issue, ensure_ascii=False, indent=2))
PY
    echo "The Linear issue was created, but its Nuphos session Link failed. Do not rerun issue-create.sh; attach the URL to issue $issue_id with attachmentCreate." >&2
    exit 1
  fi
fi

python3 - "$response" "$attachment_response" <<'PY'
import json
import os
import sys

with open(sys.argv[1]) as src:
    issue = json.load(src)["data"]["issueCreate"]["issue"]

if os.path.getsize(sys.argv[2]):
    with open(sys.argv[2]) as src:
        attachment_result = json.load(src)["data"]["attachmentCreate"]
    if not attachment_result.get("success") or not attachment_result.get("attachment"):
        print(json.dumps(attachment_result, ensure_ascii=False, indent=2), file=sys.stderr)
        raise SystemExit(1)
    issue["sourceLink"] = attachment_result["attachment"]

print(json.dumps(issue, ensure_ascii=False, indent=2))
PY
