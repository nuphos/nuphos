#!/usr/bin/env bash
set -euo pipefail

: "${NUPHOS_RUNTIME_SKILLS_URL:?runtime skills URL is unavailable}"
: "${NUPHOS_RUNTIME_SKILLS_TOKEN:?runtime skills credential is unavailable}"

# These used to arrive only from a pod spec an operator wrote. A self-hosted runtime
# takes them from the session instead, so they are now untrusted input to a file whose
# syntax is line-oriented: a newline inside either value would add curl directives of
# the caller's choosing — another `url`, an `output` path, an `upload-file`. A control
# character, a quote or a backslash has no legitimate place in either, so refuse the
# whole run rather than try to quote around it.
reject_unusable() {
  if [[ $2 =~ [[:cntrl:]\"\\] ]]; then
    printf 'runtime skills %s contains an unusable character\n' "$1" >&2
    exit 1
  fi
}
reject_unusable URL "$NUPHOS_RUNTIME_SKILLS_URL"
reject_unusable credential "$NUPHOS_RUNTIME_SKILLS_TOKEN"
if [[ ! $NUPHOS_RUNTIME_SKILLS_URL =~ ^https?:// ]]; then
  printf 'runtime skills URL must be http(s)\n' >&2
  exit 1
fi

umask 077
runtime_workspace=${NUPHOS_RUNTIME_WORKSPACE:-/workspace}
claude_dir="$runtime_workspace/.claude"
mkdir -p "$claude_dir"

# The EXIT trap below cannot run when a caller's timeout SIGKILLs this process group,
# and a slow backend makes that routine on a self-hosted runtime, so each killed run
# would otherwise leave its staging tree behind for good. Sweep the ones a dead run
# abandoned.
#
# Liveness is not inferred from age. A run can wait on the sync lock for as long as
# another holds it, and the provisioner calls this without any parent timeout, so no
# age is old enough to prove a run is gone. Instead every run holds an exclusive lock
# on its own `.owner` for its whole life, and the kernel releases that lock when the
# descriptor closes — including on SIGKILL. A tree whose `.owner` can be locked has no
# living owner. The one-minute guard only covers the instant between a run creating
# its directory and locking `.owner` in it.
sweep_abandoned() {
  local dir
  for dir in "$claude_dir"/.skills-sync.*; do
    [[ -d $dir ]] || continue
    if command -v flock >/dev/null 2>&1; then
      [[ -n $(find "$dir" -maxdepth 0 -mmin +1 2>/dev/null) ]] || continue
      if [[ -e $dir/.owner ]] && ! flock -n "$dir/.owner" true 2>/dev/null; then
        continue
      fi
    else
      # Without flock there is no liveness to ask, so fall back to age alone.
      [[ -n $(find "$dir" -maxdepth 0 -mmin +10 2>/dev/null) ]] || continue
    fi
    rm -rf "$dir"
  done
}
sweep_abandoned

tmp_dir=$(mktemp -d "$claude_dir/.skills-sync.XXXXXX")
trap 'rm -rf "$tmp_dir"' EXIT
if command -v flock >/dev/null 2>&1; then
  exec 8>"$tmp_dir/.owner"
  flock 8
fi
bundle="$tmp_dir/bundle.json"
curl_config="$tmp_dir/curl.conf"
staging="$tmp_dir/skills"
mkdir "$staging"
revision_file="$claude_dir/.skills-revision"

# A self-hosted runtime runs this on every new session, so the steady state — the
# bundle on disk is already the current one — should not pay for the whole body.
# Offer the installed revision as the entity tag; a backend that understands it
# answers 304 with no body, and one that does not simply sends the bundle.
{
  printf 'silent\nshow-error\nfail-with-body\nconnect-timeout = 10\nmax-time = 120\n'
  # Only the credential still goes through the config file, because argv is world
  # readable through /proc and this is the one value that must not be. The URL rides
  # the command line, where no config syntax can reinterpret it.
  printf 'header = "Authorization: Bearer %s"\n' "$NUPHOS_RUNTIME_SKILLS_TOKEN"
  # The revision comes from a bundle the backend produced, so it is no more trusted
  # than the values above; send it only when it cannot carry syntax of its own.
  if [[ -d $claude_dir/skills && -r $revision_file ]]; then
    installed_revision=$(cat "$revision_file")
    if [[ $installed_revision =~ ^[A-Za-z0-9._-]{1,128}$ ]]; then
      printf 'header = "If-None-Match: \\"%s\\""\n' "$installed_revision"
    fi
  fi
  printf 'output = "%s"\n' "$bundle"
  printf 'write-out = "%%{http_code}"\n'
} >"$curl_config"
chmod 600 "$curl_config"
status=$(curl --config "$curl_config" -- "$NUPHOS_RUNTIME_SKILLS_URL")

# 304 is a success with an empty body, so it must return before the body is
# parsed — `jq` on nothing would fail the script under `set -e`, and this script
# also runs on provisioned pods.
if [[ $status == 304 ]]; then
  exit 0
fi

jq -e '.revision | type == "string"' "$bundle" >/dev/null
revision=$(jq -er '.revision' "$bundle")

# From here to the end is one critical section. A self-hosted runtime runs this per
# session, so two can install at once: each moves its own `skills.<revision>.<pid>`
# into place, and the first to reach the cleanup at the bottom would delete the
# other's tree before that one had swapped the symlink onto it, leaving
# `.claude/skills` dangling. The provisioner's own re-runs can overlap a session's
# for the same reason.
#
# `flock` rather than a lock directory: the timeout around this script kills the
# process group, and a directory would survive that and wedge every later sync.
# A kernel lock is released when the descriptor closes, however the process died.
if command -v flock >/dev/null 2>&1; then
  exec 9>"$claude_dir/.skills-sync.lock"
  # Bounded, so one wedged holder cannot stall every later sync behind it. Giving up
  # is safe: this run's own `.owner` lock keeps its tree from being swept while it
  # waits, and the next session or reconcile simply tries again.
  if ! flock -w "${NUPHOS_SKILLS_LOCK_WAIT_SECONDS:-120}" 9; then
    printf 'another skills sync held the lock too long; giving up this run\n' >&2
    exit 1
  fi
fi

# Re-read under the lock: a sync that finished while this one was waiting may have
# already installed this very revision.
# The provisioner re-runs this on every reconcile of a live runtime, so the
# usual outcome is that the bundle already on disk is the one being fetched.
# Reinstalling it would be pure churn under a running agent, so stop here.
if [[ -d $claude_dir/skills && -r $revision_file && $(cat "$revision_file") == "$revision" ]]; then
  exit 0
fi

# No `-e` here: it makes jq exit 4 when a filter yields nothing at all, so a team
# that has no skills yet would fail the sync outright rather than install an empty
# tree. A malformed `.files` still fails, because iterating a non-array is an error.
jq -c '.files[]' "$bundle" | while IFS= read -r file; do
  relative=$(printf '%s' "$file" | jq -er '.path | select(type == "string" and length > 0)')
  case "$relative" in
    /*|*..*|*//*|*\\*) printf 'unsafe runtime skill path: %s\n' "$relative" >&2; exit 1 ;;
  esac
  destination="$staging/$relative"
  mkdir -p "$(dirname "$destination")"
  printf '%s' "$file" | jq -er '.contentBase64' | base64 --decode >"$destination"
  if [[ $(printf '%s' "$file" | jq -r '.executable == true') == true ]]; then
    chmod 755 "$destination"
  else
    chmod 644 "$destination"
  fi
done

# Swap the tree in through a symlink rather than `rm -rf` + `mv`. This script
# also runs against a pod that is already serving conversations — the
# provisioner re-runs it there instead of recreating the pod when a team edits
# a skill — and deleting the directory first would leave an agent process that
# happened to start in that instant with no skills at all. Replacing a symlink
# is a single rename, so a reader sees either the whole old tree or the whole
# new one.
#
# The destination carries the pid as well as the revision so that it can never
# be the directory `skills` currently points at: nothing live is removed to
# make room, whatever state the marker above is in.
installed="$claude_dir/skills.$revision.$$"
mv "$staging" "$installed"
ln -sfn "$(basename "$installed")" "$tmp_dir/skills.link"
mv -T "$tmp_dir/skills.link" "$claude_dir/skills"

# settings.json is the agent's, not a skill: it sits beside the tree rather
# than inside it. Copied rather than linked so it survives the swap above.
if [[ -r $installed/_runtime/settings.json ]]; then
  cp "$installed/_runtime/settings.json" "$claude_dir/.settings.json.incoming"
  mv -f "$claude_dir/.settings.json.incoming" "$claude_dir/settings.json"
fi

# Records what is installed so the provisioner can tell whether a push landed.
printf '%s' "$revision" >"$revision_file.incoming"
mv -f "$revision_file.incoming" "$revision_file"

# Retire the trees no longer pointed at.
find "$claude_dir" -maxdepth 1 -type d -name 'skills.*' ! -name "$(basename "$installed")" -exec rm -rf {} +
