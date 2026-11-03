#!/usr/bin/env bash
# Creates an SSH signing identity for one Nuphos participant:
#
#   setup-signing.sh <sender-id> --name "<name>" --email "<email>"
#
# The key and git config live under ~/.config/nuphos-git-identities/<sender-id>/
# and are used only through git-as. The session-global git config gets no author
# or signing settings, so other participants cannot commit under this identity
# by accident. Prints the public key to register as a Signing Key.
set -euo pipefail

usage='usage: setup-signing.sh <sender-id> --name <name> --email <email>'
id="${1:?$usage}"
shift
name=''
email=''
while [[ $# -gt 0 ]]; do
  case "$1" in
    --name) name="${2:?$usage}"; shift 2 ;;
    --email) email="${2:?$usage}"; shift 2 ;;
    *) echo "$usage" >&2; exit 2 ;;
  esac
done
[[ -n "$name" && -n "$email" ]] || { echo "$usage" >&2; exit 2; }
# Both go into a git config file verbatim; reject what could break out of a value.
for value in "$name" "$email"; do
  [[ "$value" != *[$'\n\r"\\']* ]] || { echo "setup-signing: name and email must not contain quotes, backslashes or newlines" >&2; exit 2; }
done
[[ "$email" =~ ^[^[:space:]@]+@[^[:space:]@]+$ ]] || { echo "setup-signing: invalid email" >&2; exit 2; }
# Sender ids become directory names; refuse anything that could escape them.
[[ "$id" =~ ^[A-Za-z0-9_-]+$ ]] || { echo "setup-signing: invalid sender id" >&2; exit 2; }

dir="$HOME/.config/nuphos-git-identities/$id"
key="$dir/signing_ed25519"
mkdir -p "$HOME/.config/nuphos-git-identities"
mkdir -p -m 700 "$dir"

if [[ ! -f "$key" ]]; then
  # No passphrase: the agent signs non-interactively. The key signs only and is
  # revoked by deleting it from the forge.
  ssh-keygen -q -t ed25519 -N '' -C "nuphos-signing $id $(date -u +%F)" -f "$key"
fi
chmod 600 "$key"
printf '%s %s\n' "$email" "$(cut -d' ' -f1,2 "$key.pub")" > "$dir/allowed_signers"

cat > "$dir/gitconfig" <<CONFIG
[user]
	name = "$name"
	email = "$email"
	signingkey = $key.pub
[gpg]
	format = ssh
[gpg "ssh"]
	allowedSignersFile = $dir/allowed_signers
[commit]
	gpgsign = true
[tag]
	gpgsign = true
CONFIG
chmod 600 "$dir/gitconfig"

# Nobody's identity in the shared config; commits without git-as fail loudly.
for k in user.name user.email user.signingkey gpg.format gpg.ssh.allowedSignersFile commit.gpgsign tag.gpgsign; do
  git config --global --unset-all "$k" || true
done
git config --global user.useConfigOnly true

bin="$HOME/.local/bin"
mkdir -p "$bin"
install -m 700 "$(dirname "$0")/git-as" "$bin/git-as"

# Prove the key signs and verifies before anyone relies on it.
probe="$(mktemp -d)"
trap 'rm -rf "$probe"' EXIT
git -C "$probe" init -q
"$bin/git-as" "$id" -C "$probe" commit -q --allow-empty -m 'signing probe'
"$bin/git-as" "$id" -C "$probe" verify-commit HEAD 2>/dev/null

echo "Signing identity ready for $name <$email>. Register this public key as a Signing Key:"
cat "$key.pub"
