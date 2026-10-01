#!/usr/bin/env bash
set -euo pipefail

if command -v aws >/dev/null 2>&1; then
  echo "aws already installed: $(aws --version 2>&1)"
  exit 0
fi

arch="$(uname -m)"
case "$arch" in
  x86_64|amd64) aws_arch=x86_64 ;;
  aarch64|arm64) aws_arch=aarch64 ;;
  *)
    echo "unsupported arch: $arch" >&2
    exit 1
    ;;
esac

for bin in curl unzip; do
  if ! command -v "$bin" >/dev/null 2>&1; then
    echo "required binary not found: $bin" >&2
    exit 1
  fi
done

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

url="https://awscli.amazonaws.com/awscli-exe-linux-${aws_arch}.zip"
zip="${work}/awscliv2.zip"

curl -fsSL "$url" -o "$zip"
unzip -q "$zip" -d "$work"

install_dir="/usr/local/aws-cli"
bin_dir="/usr/local/bin"
sudo_cmd=""
if [ ! -w "$bin_dir" ] || [ ! -w "$(dirname "$install_dir")" ]; then
  if command -v sudo >/dev/null 2>&1 && sudo -n true >/dev/null 2>&1; then
    sudo_cmd="sudo -n"
  else
    install_dir="$HOME/.local/aws-cli"
    bin_dir="$HOME/.local/bin"
    mkdir -p "$bin_dir"
    case ":$PATH:" in
      *:"$bin_dir":*) ;;
      *) export PATH="$bin_dir:$PATH" ;;
    esac
  fi
fi

if [ -n "$sudo_cmd" ]; then
  $sudo_cmd "$work/aws/install" --install-dir "$install_dir" --bin-dir "$bin_dir" --update
else
  "$work/aws/install" --install-dir "$install_dir" --bin-dir "$bin_dir" --update
fi

aws --version
