#!/usr/bin/env bash
set -euo pipefail

# Idempotent. The sandbox image ships these binaries; this is the fallback for
# images predating that, so a pilot never blocks on an image rollout.

if command -v tailscaled >/dev/null 2>&1 && command -v tailscale >/dev/null 2>&1; then
  echo "tailscale already installed: $(tailscale version | head -n1)"
  exit 0
fi

arch="$(uname -m)"
case "$arch" in
  x86_64) ts_arch="amd64" ;;
  aarch64 | arm64) ts_arch="arm64" ;;
  *) echo "unsupported architecture: ${arch}" >&2; exit 1 ;;
esac

version="${TAILSCALE_VERSION:-}"
if [ -z "$version" ]; then
  version="$(curl -fsS "https://pkgs.tailscale.com/stable/?mode=json" \
    | python3 -c 'import json,sys; print(json.load(sys.stdin)["TarballsVersion"])')"
fi

tarball="tailscale_${version}_${ts_arch}.tgz"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

curl -fsSL -o "${tmp}/${tarball}" "https://pkgs.tailscale.com/stable/${tarball}"
tar -xzf "${tmp}/${tarball}" -C "$tmp"
install -m 0755 "${tmp}/tailscale_${version}_${ts_arch}/tailscale" /usr/local/bin/tailscale
install -m 0755 "${tmp}/tailscale_${version}_${ts_arch}/tailscaled" /usr/local/bin/tailscaled

echo "installed $(tailscale version | head -n1)"
