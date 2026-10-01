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
    if a['name'].endswith('linux_${gh_arch}.tar.gz'):
        print(a['browser_download_url'])
        break
")"

if [ -z "$latest_url" ]; then
  echo "failed to resolve gh release URL for linux_${gh_arch}" >&2
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
  "$latest_url" -o "$tmpdir/gh.tgz"
tar -xzf "$tmpdir/gh.tgz" -C "$tmpdir"
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
