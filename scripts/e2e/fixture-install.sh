#!/bin/sh
# Stands in for a vendor's installer (NUPHOS_E2E_AGENT_INSTALLER): after a moment, puts a
# `claude` that can only start a sign-in where the real installer puts it.
set -eu
sleep 5
mkdir -p "$HOME/.local/bin"
[ -e "$HOME/.local/bin/claude" ] || cp "$(dirname "$0")/fixture-claude.mjs" "$HOME/.local/bin/claude"
chmod +x "$HOME/.local/bin/claude"
