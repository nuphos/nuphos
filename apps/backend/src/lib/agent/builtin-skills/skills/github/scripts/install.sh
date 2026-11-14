#!/usr/bin/env bash
set -euo pipefail

if command -v gh >/dev/null 2>&1; then
  echo "gh already installed: $(gh --version | head -1)"
  exit 0
fi

arch="$(uname -m)"
case "$arch" in
  x86_64|amd64) gh_arch=amd64 ;;
  aarch64|arm64) gh_arch=arm64 ;;
  *)
    echo "unsupported arch: $arch" >&2
    exit 1
    ;;
esac
# GitHub publishes the macOS builds as zip archives.
case "$(uname -s)" in
  Linux) gh_asset="linux_${gh_arch}.tar.gz" ;;
  Darwin) gh_asset="macOS_${gh_arch}.zip" ;;
  *)
    echo "unsupported OS: $(uname -s)" >&2
    exit 1
    ;;
esac

# Pin to a recent stable; resolve actual version at runtime.
latest_url="$(curl -fsSL \
  --connect-timeout 10 \
  --max-time 30 \
  --retry 2 \
  --retry-delay 1 \
  --retry-all-errors \
  https://api.github.com/repos/cli/cli/releases/latest \
  | python3 -c "
import json, sys
data = json.load(sys.stdin)
for a in data['assets']:
    if a['name'].endswith('_${gh_asset}'):
        print(a['browser_download_url'])
        break
")"

if [ -z "$latest_url" ]; then
  echo "failed to resolve gh release URL for ${gh_asset}" >&2
  exit 1
fi

tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT

curl -fsSL \
  --connect-timeout 10 \
  --max-time 60 \
  --retry 2 \
  --retry-delay 1 \
  --retry-all-errors \
  "$latest_url" -o "$tmpdir/$gh_asset"
case "$gh_asset" in
  *.zip) unzip -q "$tmpdir/$gh_asset" -d "$tmpdir" ;;
  *) tar -xzf "$tmpdir/$gh_asset" -C "$tmpdir" ;;
esac
gh_bin="$(find "$tmpdir" -type f -name gh -path '*/bin/gh' | head -1)"

if [ -z "$gh_bin" ]; then
  echo "gh binary not found in extracted archive" >&2
  exit 1
fi

# A fallback install must not replace the binary used by other sessions.
mkdir -p "$HOME/.local/bin"
mv "$gh_bin" "$HOME/.local/bin/gh"
case ":$PATH:" in
  *:"$HOME/.local/bin":*) ;;
  *) export PATH="$HOME/.local/bin:$PATH" ;;
esac
echo "Installed to ~/.local/bin/gh — add it to PATH for future shells."

gh --version | head -1
