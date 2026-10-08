#!/bin/sh
# Installs or updates the `nuphos` CLI from the newest GitHub release:
#
#   curl -fsSL https://raw.githubusercontent.com/nuphos/nuphos/main/apps/cli/install.sh | sh
#
# NUPHOS_VERSION=X.Y.Z pins a version, NUPHOS_INSTALL_DIR changes where it
# goes (default ~/.local/bin), and NUPHOS_DOWNLOAD_URL points at a mirror of
# the release assets.
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

if [ -z "$VERSION" ]; then
  # Releases come newest first; other components share the repository.
  VERSION=$(curl -fsSL "https://api.github.com/repos/$REPO/releases?per_page=50" |
    sed -n 's/.*"tag_name": *"cli-v\([0-9.]*\)".*/\1/p' | head -n 1)
  [ -n "$VERSION" ] || fail "no CLI release found"
fi

base=${NUPHOS_DOWNLOAD_URL:-https://github.com/$REPO/releases/download/cli-v$VERSION}
asset="nuphos-$target.tar.gz"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

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
  *) echo "Add $DIR to your PATH, e.g.: export PATH=\"$DIR:\$PATH\"" ;;
esac
