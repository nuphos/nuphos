#!/bin/sh
# Installs or updates the `nuphos` CLI from the newest release:
#
#   curl -fsSL https://nuphos.ai/install | sh
#
# and joins this machine as one of your computers with a one-time token:
#
#   curl -fsSL https://nuphos.ai/install | sh -s -- --join TOKEN [--api-url URL]
#
# NUPHOS_VERSION=X.Y.Z pins a version, NUPHOS_INSTALL_DIR changes where it
# goes (default ~/.local/bin), NUPHOS_DOWNLOAD_URL points at a mirror of the
# release assets, NUPHOS_LATEST_URL at another backend's /cli/latest, and
# NUPHOS_NO_MODIFY_PATH=1 leaves your shell profile alone.
set -eu

REPO=nuphos/nuphos
DIR=${NUPHOS_INSTALL_DIR:-$HOME/.local/bin}
VERSION=${NUPHOS_VERSION:-}
JOIN=

fail() {
  echo "nuphos install: $*" >&2
  exit 1
}

# The usage message names no argument, so a misplaced token is never printed.
while [ $# -gt 0 ]; do
  case "$#:$1" in
    1:*) fail "usage: sh -s -- --join TOKEN [--api-url URL]" ;;
    *:--join) JOIN=$2 ;;
    *:--api-url) export NUPHOS_API_URL="$2" ;;
    *) fail "usage: sh -s -- --join TOKEN [--api-url URL]" ;;
  esac
  shift 2
done

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
# Like rustup and bun, put $DIR on PATH for new shells by adding one line to the
# login shell's profile, once.
line="export PATH=\"$DIR:\$PATH\""
case "${SHELL##*/}" in
  zsh) profile=${ZDOTDIR:-$HOME}/.zprofile ;;
  bash)
    # A login bash reads only the first of these that exists.
    profile=$HOME/.profile
    for f in "$HOME/.bash_login" "$HOME/.bash_profile"; do
      if [ -f "$f" ]; then profile=$f; fi
    done
    ;;
  *) profile=$HOME/.profile ;;
esac
case ":$PATH:" in
  *":$DIR:"*) ;;
  *)
    if [ "${NUPHOS_NO_MODIFY_PATH:-}" != 1 ] &&
      { grep -qsxF "$line" "$profile" || printf '\n%s\n' "$line" >>"$profile"; }; then
      echo "Added $DIR to PATH in $profile; open a new shell to run \`nuphos\`."
    else
      echo "warning: $DIR is not on your PATH, so \`nuphos\` will not be found. Add it, e.g. in your shell profile:" >&2
      echo "  $line" >&2
    fi
    ;;
esac

# Started here by its path, since this shell's PATH change cannot reach the caller's.
if [ -n "$JOIN" ]; then
  rm -rf "$tmp"
  NUPHOS_JOIN_TOKEN=$JOIN exec "$DIR/nuphos" agent
fi
