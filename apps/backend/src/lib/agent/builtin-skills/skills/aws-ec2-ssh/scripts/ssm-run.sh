#!/usr/bin/env bash
# Run a single shell command on a bound EC2 instance via SSM Run Command
# (AWS-RunShellScript). No open port, no SSH key. Sends the command, polls to a
# terminal status, prints stdout/stderr, and exits with the remote exit code.
#
# Usage:  ssm-run.sh <instance-id> <region> <command>
# Env:    SSM_S3_BUCKET   capture full output to this S3 bucket (inline output
#                         from get-command-invocation is capped ~2500 chars)
#         SSM_TIMEOUT     max seconds to poll before giving up (default 120)
#
# Requires the `aws` skill's setup-credentials.sh to have run first, and the
# bound role to hold ssm:SendCommand + ssm:GetCommandInvocation.
set -euo pipefail

if [ "$#" -lt 3 ]; then
  echo "Usage: ssm-run.sh <instance-id> <region> <command>" >&2
  exit 1
fi

iid="$1"
region="$2"
shift 2
cmd="$*"

command -v python3 >/dev/null 2>&1 || { echo "python3 required" >&2; exit 1; }

# Build the SSM parameters JSON safely (avoids shell quoting of the command).
params="$(python3 -c 'import json,sys; print(json.dumps({"commands":[sys.argv[1]]}))' "$cmd")"

send_args=(ssm send-command --region "$region"
  --instance-ids "$iid"
  --document-name AWS-RunShellScript
  --parameters "$params"
  --query Command.CommandId --output text)
[ -n "${SSM_S3_BUCKET:-}" ] && send_args+=(--output-s3-bucket-name "$SSM_S3_BUCKET")

echo "Sending SSM command to ${iid} in ${region}" >&2
cmd_id="$(aws "${send_args[@]}")"
echo "CommandId: ${cmd_id}" >&2

deadline=$(( ${SSM_TIMEOUT:-120} ))
elapsed=0
status="Pending"
while :; do
  # get-command-invocation can 404 (InvocationDoesNotExist) for a moment right
  # after send — tolerate it while polling.
  out="$(aws ssm get-command-invocation --region "$region" \
    --command-id "$cmd_id" --instance-id "$iid" --output json 2>/dev/null || true)"
  if [ -n "$out" ]; then
    status="$(printf '%s' "$out" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("Status",""))')"
    case "$status" in
      Success|Failed|Cancelled|TimedOut) break ;;
    esac
  fi
  if [ "$elapsed" -ge "$deadline" ]; then
    echo "SSM command still ${status} after ${deadline}s; re-check with:" >&2
    echo "  aws ssm get-command-invocation --command-id ${cmd_id} --instance-id ${iid} --region ${region}" >&2
    exit 124
  fi
  sleep 3
  elapsed=$(( elapsed + 3 ))
done

# Emit stdout, stderr, and propagate the remote exit code.
printf '%s' "$out" | python3 -c '
import json, sys
d = json.load(sys.stdin)
so = d.get("StandardOutputContent", "")
se = d.get("StandardErrorContent", "")
if so: sys.stdout.write(so)
if se: sys.stderr.write(se)
if d.get("StandardOutputContent") and len(so) >= 2400:
    sys.stderr.write("\n[output likely truncated at ~2500 chars — re-run with SSM_S3_BUCKET=<bucket> for full output]\n")
sys.exit(int(d.get("ResponseCode", 0)) if d.get("Status") == "Success" else 1)
'
