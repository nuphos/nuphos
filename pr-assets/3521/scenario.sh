#!/bin/bash
# $1 = on | off. Puts the CLI back on 0.21.0, sets the switch, starts the host, waits, reports.
set -e
export XDG_RUNTIME_DIR=/run/user/$(id -u)
systemctl --user stop nuphos-agent 2>/dev/null || true
curl -fsSL https://raw.githubusercontent.com/nuphos/nuphos/cli-v0.21.0/apps/cli/install.sh | NUPHOS_VERSION=0.21.0 NUPHOS_INSTALL_DIR="$HOME/.local/bin" sh >/dev/null
rm -f ~/agent-home/auto-update.json ~/agent-home/auto-update-tried
[ "$1" = off ] && echo '{"enabled":false}' > ~/agent-home/auto-update.json
echo "$(date -u +%T) scenario=$1 before: $(~/.local/bin/nuphos --version)"
systemctl --user start nuphos-agent
sleep 90
echo "$(date -u +%T) after 90 s idle: $(~/.local/bin/nuphos --version)"
echo "  tried file: $(cat ~/agent-home/auto-update-tried 2>/dev/null || echo none)"
echo "  host starts in the unit's journal: $(journalctl --user -u nuphos-agent --since '-100s' -o cat 2>/dev/null | grep -c 'Started\|nuphos-agent.service' || true)"
journalctl --user -u nuphos-agent --since '-100s' -o short-iso 2>/dev/null | grep -iE 'Started|Stopp|update|Could not' | tail -6
