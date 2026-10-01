#!/usr/bin/env bash
set -euo pipefail

if command -v helm >/dev/null 2>&1; then
  echo "helm already installed: $(helm version --short)"
  exit 0
fi

arch="$(uname -m)"
case "$arch" in
  x86_64|amd64) helm_arch=amd64 ;;
  aarch64|arm64) helm_arch=arm64 ;;
  *)
    echo "unsupported arch: $arch" >&2
    exit 1
    ;;
esac

# Resolve the latest stable release tag from GitHub (no auth required).
latest="$(curl -fsSL https://api.github.com/repos/helm/helm/releases/latest \
  | grep '"tag_name"' | head -1 | sed -E 's/.*"([^"]+)".*/\1/')"

if [ -z "$latest" ]; then
  echo "could not resolve latest helm release" >&2
  exit 1
fi

url="https://get.helm.sh/helm-${latest}-linux-${helm_arch}.tar.gz"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

curl -fsSL "$url" -o "${tmp}/helm.tar.gz"
tar -xzf "${tmp}/helm.tar.gz" -C "$tmp"

bin="${tmp}/linux-${helm_arch}/helm"
chmod +x "$bin"

if [ -w /usr/local/bin ]; then
  mv "$bin" /usr/local/bin/helm
elif command -v sudo >/dev/null 2>&1 && sudo -n true >/dev/null 2>&1; then
  sudo -n mv "$bin" /usr/local/bin/helm
else
  mkdir -p "$HOME/.local/bin"
  mv "$bin" "$HOME/.local/bin/helm"
  case ":$PATH:" in
    *:"$HOME/.local/bin":*) ;;
    *) export PATH="$HOME/.local/bin:$PATH" ;;
  esac
  echo "Installed to ~/.local/bin/helm — add it to PATH for future shells."
fi

helm version --short
