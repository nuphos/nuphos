#!/usr/bin/env bash
set -euo pipefail

bin_dir="$HOME/.local/bin"
if [ -x "$bin_dir/gcloud" ] || command -v gcloud >/dev/null 2>&1; then
  echo "gcloud already installed"
  exit 0
fi

arch="$(uname -m)"
case "$arch" in
  x86_64|amd64) gc_arch=x86_64 ;;
  aarch64|arm64) gc_arch=arm ;;
  *)
    echo "unsupported arch: $arch" >&2
    exit 1
    ;;
esac

for bin in curl tar; do
  if ! command -v "$bin" >/dev/null 2>&1; then
    echo "required binary not found: $bin" >&2
    exit 1
  fi
done

install_root="$HOME/.local/share"
mkdir -p "$install_root"

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

url="https://dl.google.com/dl/cloudsdk/channels/rapid/downloads/google-cloud-cli-linux-${gc_arch}.tar.gz"
tarball="${work}/google-cloud-cli.tar.gz"

curl -fsSL "$url" -o "$tarball"
tar -xzf "$tarball" -C "$install_root"

sdk_dir="$install_root/google-cloud-sdk"
"$sdk_dir/install.sh" --quiet --usage-reporting=false --path-update=false --command-completion=false >/dev/null

mkdir -p "$bin_dir"
ln -sf "$sdk_dir/bin/gcloud" "$bin_dir/gcloud"
ln -sf "$sdk_dir/bin/gsutil" "$bin_dir/gsutil"
ln -sf "$sdk_dir/bin/bq" "$bin_dir/bq"

case ":$PATH:" in
  *:"$bin_dir":*) ;;
  *) export PATH="$bin_dir:$PATH" ;;
esac

echo "Installed at: $sdk_dir"
echo "PATH-shimmed in: $bin_dir (re-export PATH if a new shell can't find gcloud)"
