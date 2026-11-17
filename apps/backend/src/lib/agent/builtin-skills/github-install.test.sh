#!/usr/bin/env bash
# Runs the github skill's install.sh against a fake release that holds only the
# archive for this OS and CPU, so asking for any other platform's build fails.
# Runs it again with a gh on PATH that cannot execute, which must be replaced.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

case "$(uname -m)" in
  x86_64 | amd64) arch=amd64 ;;
  *) arch=arm64 ;;
esac
mkdir -p "$work/release" "$work/bin" "$work/home"
case "$(uname -s)" in
  Darwin) dir="gh_0.0.0_macOS_$arch" ;;
  *) dir="gh_0.0.0_linux_$arch" ;;
esac
mkdir -p "$work/$dir/bin"
printf '#!/bin/sh\necho "gh version 0.0.0"\n' >"$work/$dir/bin/gh"
chmod 755 "$work/$dir/bin/gh"
case "$(uname -s)" in
  Darwin) (cd "$work" && zip -qr "release/$dir.zip" "$dir") ;;
  *) tar -czf "$work/release/$dir.tar.gz" -C "$work" "$dir" ;;
esac

# A PATH with the installer's tools but no gh, and a curl that serves the fake release.
for tool in uname python3 mktemp rm unzip tar gzip find head mkdir mv cat cp basename; do
  ln -s "$(command -v "$tool")" "$work/bin/$tool"
done
cat >"$work/bin/curl" <<'EOF'
#!/bin/sh
out= url=
while [ "$#" -gt 0 ]; do
  case "$1" in
    -o) out=$2; shift ;;
    http*) url=$1 ;;
  esac
  shift
done
case "$url" in
  */releases/latest)
    for name in linux_amd64.tar.gz linux_arm64.tar.gz macOS_amd64.zip macOS_arm64.zip; do
      list="$list{\"name\":\"gh_0.0.0_$name\",\"browser_download_url\":\"https://release.invalid/gh_0.0.0_$name\"},"
    done
    echo "{\"assets\":[${list%,}]}"
    ;;
  *) cp "$FAKE_RELEASE/$(basename "$url")" "$out" ;;
esac
EOF
chmod 755 "$work/bin/curl"

# install_and_check LABEL: runs install.sh, then requires the fake release's gh.
install_and_check() {
  out="$(env -i HOME="$work/home" PATH="$work/home/.local/bin:$work/bin" \
    FAKE_RELEASE="$work/release" "$BASH" "$here/skills/github/scripts/install.sh" 2>&1)" || {
    echo "FAIL ($1): install.sh failed on $(uname -s) $(uname -m): $out" >&2
    exit 1
  }
  case "$out" in
    *"gh version 0.0.0"*) ;;
    *)
      echo "FAIL ($1): the installed gh did not run: $out" >&2
      exit 1
      ;;
  esac
}

install_and_check "no gh on PATH"

# A gh that is on PATH but cannot run, as a build for another OS would be.
printf '\177ELF\0\0\0' >"$work/home/.local/bin/gh"
chmod 755 "$work/home/.local/bin/gh"
install_and_check "a gh that cannot run"
case "$out" in
  *"already installed"*)
    echo "FAIL: a gh that cannot run was taken as installed" >&2
    exit 1
    ;;
esac

echo "ok: install.sh installs a runnable gh, also over one that cannot run, on $(uname -s) $(uname -m)"
