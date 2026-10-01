#!/usr/bin/env bash
# Run a command on a bound EC2 instance over SSH using EC2 Instance Connect.
# Generates an ephemeral keypair, pushes the public key (valid 60s), then SSHes.
# Direct for a public IP, or through an EC2 Instance Connect Endpoint (EICE) for
# a private instance. stdin is forwarded to the remote shell (append `< script`).
#
# Usage:  eic-ssh.sh <instance-id> <region> <command>
# Env:    EICE=1        tunnel through an EC2 Instance Connect Endpoint (private)
#         SSH_USER      OS user (default guessed from AMI: ec2-user / ubuntu)
#         SSH_TIMEOUT   connect timeout seconds (default 20)
#
# Requires the `aws` skill's setup-credentials.sh first, and the bound role to
# hold ec2-instance-connect:SendSSHPublicKey (+ OpenTunnel for EICE) and
# ec2:DescribeInstances.
set -euo pipefail

if [ "$#" -lt 3 ]; then
  echo "Usage: eic-ssh.sh <instance-id> <region> <command>" >&2
  exit 1
fi

iid="$1"
region="$2"
shift 2
cmd="$*"

command -v python3 >/dev/null 2>&1 || { echo "python3 required" >&2; exit 1; }

desc="$(aws ec2 describe-instances --region "$region" --instance-ids "$iid" \
  --query 'Reservations[0].Instances[0].[Placement.AvailabilityZone,PublicIpAddress,PrivateIpAddress,ImageId,PlatformDetails]' \
  --output json)"
read -r az public_ip private_ip _image platform < <(printf '%s' "$desc" | python3 -c '
import json, sys
a = json.load(sys.stdin)
print(*[("" if x in (None, "null") else x) for x in a])
')

# Guess the default OS user from the AMI description when not overridden.
user="${SSH_USER:-}"
if [ -z "$user" ]; then
  descr="$(aws ec2 describe-images --region "$region" --image-ids "$_image" \
    --query 'Images[0].Description' --output text 2>/dev/null || echo '')"
  case "$(printf '%s' "$descr" | tr 'A-Z' 'a-z')" in
    *ubuntu*) user=ubuntu ;;
    *debian*) user=admin ;;
    *) user=ec2-user ;;
  esac
fi

tmpkey="$(mktemp -u)"
trap 'rm -f "$tmpkey" "$tmpkey.pub"' EXIT
ssh-keygen -q -t rsa -b 2048 -N '' -f "$tmpkey" -C "nuphos-eic-${iid}"

echo "Pushing ephemeral key to ${iid} (user ${user}, 60s validity)" >&2
aws ec2-instance-connect send-ssh-public-key --region "$region" \
  --instance-id "$iid" \
  --instance-os-user "$user" \
  ${az:+--availability-zone "$az"} \
  --ssh-public-key "file://${tmpkey}.pub" >/dev/null

ssh_opts=(-i "$tmpkey" -o BatchMode=yes -o StrictHostKeyChecking=accept-new
  -o "ConnectTimeout=${SSH_TIMEOUT:-20}")

if [ "${EICE:-0}" = "1" ]; then
  # Tunnel through the EC2 Instance Connect Endpoint — no public IP needed.
  ssh_opts+=(-o "ProxyCommand=aws ec2-instance-connect open-tunnel --region ${region} --instance-id ${iid}")
  target="$iid"
else
  target="${public_ip:-$private_ip}"
  if [ -z "$target" ]; then
    echo "Instance has no public IP; set EICE=1 to tunnel through an endpoint" >&2
    exit 1
  fi
fi

# Not `exec` — that would replace the shell and skip the EXIT trap, leaking the
# ephemeral key. Run ssh as a child; set -e propagates its exit code and the
# trap still removes the key on the way out.
ssh "${ssh_opts[@]}" "${user}@${target}" "$cmd"
