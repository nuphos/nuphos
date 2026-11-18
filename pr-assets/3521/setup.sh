#!/bin/bash
# Disposable e2e for nuphos/nuphos#3521 on a fresh Debian VM. Runs as the login user.
set -e
cd ~
sudo apt-get update -qq >/dev/null && sudo apt-get install -y -qq curl xz-utils >/dev/null
# Node 22 for the host.
curl -fsSL https://nodejs.org/dist/latest-v22.x/SHASUMS256.txt -o sums.txt
NODE=$(grep -o 'node-v22[0-9.]*-linux-x64.tar.xz' sums.txt | head -1)
curl -fsSL "https://nodejs.org/dist/latest-v22.x/$NODE" -o node.tar.xz && mkdir -p ~/node && tar -xJf node.tar.xz -C ~/node --strip-components=1
# The real nuphos CLI 0.21.0, and its runtime bundle with #3521's host.mjs in it.
curl -fsSL https://raw.githubusercontent.com/nuphos/nuphos/cli-v0.21.0/apps/cli/install.sh | NUPHOS_VERSION=0.21.0 NUPHOS_INSTALL_DIR="$HOME/.local/bin" sh >/dev/null
mkdir -p ~/rt && curl -fsSL https://github.com/nuphos/nuphos/releases/download/cli-v0.21.0/nuphos-agent-linux-x64.tar.gz | tar -xz -C ~/rt
cp ~/e2e/host.mjs ~/rt/host.mjs
mkdir -p ~/.config/systemd/user ~/agent-home
cat > ~/.config/systemd/user/nuphos-e2e-stub.service <<UNIT
[Service]
ExecStart=$HOME/node/bin/node $HOME/e2e/stub.mjs
UNIT
# Named as \`nuphos update\`'s restart_if_active expects. NUPHOS_CLI_EXE is what #3521's agent.rs
# passes under the service; 0.21.0's agent.rs predates it, so the unit sets it.
cat > ~/.config/systemd/user/nuphos-agent.service <<UNIT
[Unit]
After=nuphos-e2e-stub.service
[Service]
ExecStart=$HOME/node/bin/node $HOME/rt/host.mjs
Environment=PATH=$HOME/node/bin:$HOME/.local/bin:/usr/bin:/bin
Environment=NUPHOS_AGENT_HOME=$HOME/agent-home
Environment=NUPHOS_LOCAL_RUNTIME_DIR=$HOME/rt
Environment=NUPHOS_API_URL=http://127.0.0.1:8787
Environment=NUPHOS_SESSION_TOKEN=e2e
Environment=NUPHOS_CLI_VERSION=0.21.0
Environment=NUPHOS_CLI_EXE=$HOME/.local/bin/nuphos
Environment=NUPHOS_AUTO_UPDATE_IDLE_SECONDS=30
Environment=NUPHOS_AUTO_UPDATE_CHECK_SECONDS=5
Restart=always
UNIT
sudo loginctl enable-linger "$USER"
systemctl --user daemon-reload
systemctl --user start nuphos-e2e-stub
echo "installed: $(~/.local/bin/nuphos --version)"
