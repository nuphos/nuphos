#!/usr/bin/env bash
set -euo pipefail

if command -v eksctl >/dev/null 2>&1; then
  echo "eksctl already installed: $(eksctl version)"
  exit 0
fi

arch="$(uname -m)"
case "$arch" in
  x86_64|amd64) eks_arch=amd64 ;;
  aarch64|arm64) eks_arch=arm64 ;;
  *)
    echo "unsupported arch: $arch" >&2
    exit 1
    ;;
esac

url="https://github.com/eksctl-io/eksctl/releases/latest/download/eksctl_Linux_${eks_arch}.tar.gz"

tmp="$(mktemp -d)"
curl -fsSL "$url" -o "$tmp/eksctl.tar.gz"
tar -xzf "$tmp/eksctl.tar.gz" -C "$tmp"

if [ -w /usr/local/bin ]; then
  mv "$tmp/eksctl" /usr/local/bin/eksctl
elif command -v sudo >/dev/null 2>&1 && sudo -n true >/dev/null 2>&1; then
  sudo -n mv "$tmp/eksctl" /usr/local/bin/eksctl
else
  mkdir -p "$HOME/.local/bin"
  mv "$tmp/eksctl" "$HOME/.local/bin/eksctl"
  case ":$PATH:" in
    *:"$HOME/.local/bin":*) ;;
    *) export PATH="$HOME/.local/bin:$PATH" ;;
  esac
  echo "Installed to ~/.local/bin/eksctl — add it to PATH for future shells."
fi

rm -rf "$tmp"
eksctl version
