#!/usr/bin/env bash
# Run a single command on a bound GCE VM over `gcloud compute ssh`.
#
# Usage:   gce-ssh.sh <vm> <zone> <command>
# Env:     GCE_PROJECT  pin --project (default: gcloud's active config project)
#          NO_IAP=1     do NOT tunnel through IAP (VM must have a reachable IP)
#          SSH_TIMEOUT  connect timeout seconds (default 20)
#
# Requires gcloud already authenticated for the bound project — run
#   bash skills/gcloud/scripts/setup-credentials.sh <teamId> <projectId>
# first. Passes the remote command's stdout/stderr through and exits with its
# exit code.
set -euo pipefail

if [ "$#" -lt 3 ]; then
  echo "Usage: gce-ssh.sh <vm> <zone> <command>" >&2
  exit 1
fi

vm="$1"
zone="$2"
shift 2
cmd="$*"

args=(compute ssh "$vm" --zone "$zone" --quiet)
[ -n "${GCE_PROJECT:-}" ] && args+=(--project "$GCE_PROJECT")
[ "${NO_IAP:-0}" = "1" ] || args+=(--tunnel-through-iap)

# Everything after `--` is passed to the underlying ssh client. BatchMode makes
# a failed auth fail fast instead of hanging on a password prompt.
exec gcloud "${args[@]}" --command "$cmd" -- \
  -o BatchMode=yes \
  -o StrictHostKeyChecking=accept-new \
  -o "ConnectTimeout=${SSH_TIMEOUT:-20}"
