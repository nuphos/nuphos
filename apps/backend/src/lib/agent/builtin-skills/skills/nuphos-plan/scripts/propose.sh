#!/usr/bin/env bash
set -euo pipefail

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
proposal=${1:?usage: propose.sh PROPOSAL_JSON}

if ! jq -e '
  type == "object" and
  (.title | type == "string" and length > 0 and length <= 120) and
  ((.overview // "") | type == "string" and length <= 400) and
  (.decisions | type == "array" and length <= 12) and
  all(.decisions[]; type == "object" and
    (.label | type == "string" and length > 0 and length <= 60) and
    (.value | type == "string" and length > 0 and length <= 200)) and
  (.steps | type == "array" and length > 0 and length <= 10) and
  all(.steps[]; type == "object" and
    (.title | type == "string" and length > 0 and length <= 80) and
    ((.description // "") | type == "string" and length <= 300) and
    (.jobs | type == "array" and length > 0 and length <= 12) and
    all(.jobs[]; type == "object" and
      (.title | type == "string" and length > 0 and length <= 120) and
      ((.description // "") | type == "string" and length <= 400) and
      (.commands | type == "array" and length > 0 and length <= 20) and
      all(.commands[]; type == "object" and
        (.command | type == "string" and length > 0 and length <= 2000) and
        ((.description // "") | type == "string" and length <= 200)))) and
  (.costSummary | type == "string" and length > 0 and length <= 200) and
  ((.costOneTime // "") | type == "string" and length <= 120) and
  ((.costMonthly // "") | type == "string" and length <= 120) and
  ((.costSavings // "") | type == "string" and length <= 120) and
  (.riskWorstCase | type == "string" and length > 0 and length <= 400) and
  (.riskMitigations | type == "array" and length > 0 and length <= 8) and
  all(.riskMitigations[]; type == "string" and length > 0 and length <= 200)
' >/dev/null 2>&1 <<<"$proposal"; then
  cat >&2 <<'EOF'
invalid proposal JSON: expected the complete card shape below within Plan limits
{
  "title": "... (max 120)", "overview": "... (max 400)",
  "decisions": [{"label": "max 60", "value": "max 200"}],
  "steps": [{"title": "max 80", "jobs": [{"title": "max 120", "commands": [{"command": "max 2000", "description": "max 200"}]}]}],
  "costSummary": "max 200",
  "riskWorstCase": "max 400", "riskMitigations": ["each max 200"]
}
EOF
  exit 2
fi

# One server-side insert after full schema validation. Never expose an empty
# shell that can trip the approval gate or render as an eternal Building plan.
exec bash "$script_dir/_request.sh" POST "/proposals" "$proposal"
