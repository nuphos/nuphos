#!/bin/sh
# Runs install.sh against a fake local release, for zsh and bash users with
# ~/.local/bin off PATH: the profile gains one PATH line however often it runs,
# and a new login shell finds `nuphos`.
set -eu

here=$(cd "$(dirname "$0")" && pwd)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

case "$(uname -s)" in
  Darwin) os=apple-darwin ;;
  *) os=unknown-linux-musl ;;
esac
case "$(uname -m)" in
  x86_64 | amd64) arch=x86_64 ;;
  *) arch=aarch64 ;;
esac
asset=nuphos-$arch-$os.tar.gz
mkdir "$work/release"
printf '#!/bin/sh\necho "nuphos 0.0.0"\n' >"$work/nuphos"
chmod 755 "$work/nuphos"
tar -czf "$work/release/$asset" -C "$work" nuphos
if command -v sha256sum >/dev/null 2>&1; then
  sha256sum "$work/release/$asset" >"$work/release/$asset.sha256"
else
  shasum -a 256 "$work/release/$asset" >"$work/release/$asset.sha256"
fi

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

# run_install HOME [VAR=VALUE...]: runs install.sh with a PATH lacking ~/.local/bin.
run_install() {
  user_home=$1
  shift
  env -i HOME="$user_home" PATH=/usr/bin:/bin "$@" \
    NUPHOS_VERSION=0.0.0 NUPHOS_DOWNLOAD_URL="file://$work/release" \
    sh "$here/install.sh" >/dev/null 2>&1 || fail "install.sh failed with $*"
}

# check SHELL PROFILE [SETUP]: installs twice, then asks a new login shell for nuphos.
check() {
  sh=$(command -v "$1") || fail "$1 is not installed"
  home=$(mktemp -d "$work/home.XXXXXX")
  if [ -n "${3:-}" ]; then touch "$home/$3"; fi
  run_install "$home" SHELL="$sh"
  run_install "$home" SHELL="$sh"
  n=$(grep -c 'export PATH=' "$home/$2" || true)
  [ "$n" = 1 ] || fail "$1: expected one PATH line in ~/$2, found $n"
  found=$(env -i HOME="$home" PATH=/usr/bin:/bin "$sh" -lc 'command -v nuphos') || true
  [ "$found" = "$home/.local/bin/nuphos" ] || fail "$1 -l found '$found', not ~/.local/bin/nuphos"
  echo "ok: $1 adds one line to ~/$2 and a login shell finds nuphos"
}

check zsh .zprofile
check bash .profile
check bash .bash_profile .bash_profile

home=$(mktemp -d "$work/home.XXXXXX")
run_install "$home" SHELL="$(command -v zsh)" NUPHOS_NO_MODIFY_PATH=1
[ ! -e "$home/.zprofile" ] || fail "NUPHOS_NO_MODIFY_PATH=1 still wrote ~/.zprofile"
echo "ok: NUPHOS_NO_MODIFY_PATH=1 leaves the profile alone"

# cron, systemd units and bare containers often have no SHELL at all.
home=$(mktemp -d "$work/home.XXXXXX")
run_install "$home"
grep -q 'export PATH=' "$home/.profile" || fail "without SHELL, ~/.profile got no PATH line"
echo "ok: without SHELL, ~/.profile gets the PATH line"
