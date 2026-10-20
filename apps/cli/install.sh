#!/bin/sh
# Installs or updates the `nuphos` CLI from the newest release:
#
#   curl -fsSL https://nuphos.ai/install | sh
#
# NUPHOS_VERSION=X.Y.Z pins a version, NUPHOS_INSTALL_DIR changes where it
# goes (default ~/.local/bin), NUPHOS_DOWNLOAD_URL points at a mirror of the
# release assets, and NUPHOS_LATEST_URL at another backend's /cli/latest.
set -eu

REPO=nuphos/nuphos
DIR=${NUPHOS_INSTALL_DIR:-$HOME/.local/bin}
VERSION=${NUPHOS_VERSION:-}

fail() {
  echo "nuphos install: $*" >&2
  exit 1
}

case "$(uname -s)" in
  Darwin) os=apple-darwin ;;
  Linux) os=unknown-linux-musl ;;
  *) fail "unsupported system $(uname -s); build from source in apps/cli" ;;
esac
case "$(uname -m)" in
  x86_64 | amd64) arch=x86_64 ;;
  arm64 | aarch64) arch=aarch64 ;;
  *) fail "unsupported architecture $(uname -m)" ;;
esac
target="$arch-$os"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

if [ -z "$VERSION" ]; then
  # Asked of Nuphos rather than the GitHub API, which rate-limits shared IPs.
  latest=${NUPHOS_LATEST_URL:-https://api.nuphos.ai/cli/latest}
  VERSION=$(curl -fsS "$latest" 2>"$tmp/latest.err") ||
    fail "could not look up the newest version at $latest: $(cat "$tmp/latest.err")
Set NUPHOS_VERSION=X.Y.Z to install a known version (see https://github.com/$REPO/releases)."
  case "$VERSION" in
    [0-9]*.[0-9]*.[0-9]*) ;;
    *) fail "unexpected answer from $latest: $VERSION" ;;
  esac
fi

base=${NUPHOS_DOWNLOAD_URL:-https://github.com/$REPO/releases/download/cli-v$VERSION}
asset="nuphos-$target.tar.gz"
echo "Installing nuphos $VERSION ($target) into $DIR"
curl -fsSL "$base/$asset" -o "$tmp/$asset" || fail "could not download $base/$asset"
curl -fsSL "$base/$asset.sha256" -o "$tmp/$asset.sha256" || fail "could not download the checksum"
expected=$(cut -d ' ' -f 1 "$tmp/$asset.sha256")
if command -v sha256sum >/dev/null 2>&1; then
  actual=$(sha256sum "$tmp/$asset" | cut -d ' ' -f 1)
else
  actual=$(shasum -a 256 "$tmp/$asset" | cut -d ' ' -f 1)
fi
[ "$expected" = "$actual" ] || fail "checksum mismatch for $asset"

tar -xzf "$tmp/$asset" -C "$tmp"
mkdir -p "$DIR"
# Moved into place rather than overwritten, so a running nuphos keeps working.
mv "$tmp/nuphos" "$DIR/nuphos.new"
chmod 755 "$DIR/nuphos.new"
mv -f "$DIR/nuphos.new" "$DIR/nuphos"

echo "Installed $("$DIR/nuphos" --version)"
case ":$PATH:" in
  *":$DIR:"*) ;;
  *)
    echo "warning: $DIR is not on your PATH, so \`nuphos\` will not be found. Add it, e.g. in your shell profile:" >&2
    echo "  export PATH=\"$DIR:\$PATH\"" >&2
    ;;
esac
