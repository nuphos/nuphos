#!/usr/bin/env bash
set -euo pipefail

if command -v kubectl >/dev/null 2>&1; then
  echo "kubectl already installed: $(kubectl version --client --output=yaml 2>/dev/null | grep -E '^\s*gitVersion' | head -1 | awk '{print $2}')"
  exit 0
fi

arch="$(uname -m)"
case "$arch" in
  x86_64|amd64) kube_arch=amd64 ;;
  aarch64|arm64) kube_arch=arm64 ;;
  *)
    echo "unsupported arch: $arch" >&2
    exit 1
    ;;
esac

stable="$(curl -fsSL https://dl.k8s.io/release/stable.txt)"
url="https://dl.k8s.io/release/${stable}/bin/linux/${kube_arch}/kubectl"

tmp="$(mktemp)"
curl -fsSL "$url" -o "$tmp"
chmod +x "$tmp"

if [ -w /usr/local/bin ]; then
  mv "$tmp" /usr/local/bin/kubectl
elif command -v sudo >/dev/null 2>&1 && sudo -n true >/dev/null 2>&1; then
  sudo -n mv "$tmp" /usr/local/bin/kubectl
else
  mkdir -p "$HOME/.local/bin"
  mv "$tmp" "$HOME/.local/bin/kubectl"
  case ":$PATH:" in
    *:"$HOME/.local/bin":*) ;;
    *) export PATH="$HOME/.local/bin:$PATH" ;;
  esac
  echo "Installed to ~/.local/bin/kubectl — add it to PATH for future shells."
fi

kubectl version --client --output=yaml | grep -E '^\s*gitVersion' | head -1
