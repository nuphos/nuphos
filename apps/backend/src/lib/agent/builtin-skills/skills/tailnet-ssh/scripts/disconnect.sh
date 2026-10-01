#!/usr/bin/env bash
set -euo pipefail

# The node is ephemeral, so the control plane reaps it when the sandbox dies.
# This just makes that immediate when a turn is finished with the tailnet.

state_dir="${HOME}/.tailnet-ssh"
sock="${state_dir}/tailscaled.sock"

if [ ! -S "$sock" ]; then
  echo "Not joined to a tailnet."
  exit 0
fi

tailscale --socket="$sock" logout || true
pkill -f "tailscaled --tun=userspace-networking --socket=${sock}" || true
rm -rf "$state_dir"

# Leaving the ssh block behind would point every later tailnet ssh at a
# ProxyCommand whose socket no longer exists.
ssh_config="$HOME/.ssh/config"
if [ -f "$ssh_config" ]; then
  sed -i '/^# >>> nuphos-tailnet-ssh >>>$/,/^# <<< nuphos-tailnet-ssh <<<$/d' "$ssh_config"
fi

echo "Left the tailnet."
