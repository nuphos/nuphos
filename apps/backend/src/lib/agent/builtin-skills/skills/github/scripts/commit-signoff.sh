#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat >&2 <<EOF
Usage: commit-signoff.sh <owner/repo>

Prints the DCO trailer for commits that the current \`gh\` identity creates in
<owner/repo> with GraphQL createCommitOnBranch:

  Signed-off-by: <author name> <author email>

GitHub picks that author itself (a member's commit email, or the App's
<slug>[bot] noreply address), and no read-only API reports the commit email.
So this creates a throwaway branch at the default branch head, makes an empty
commit there, reads the author GitHub recorded and deletes the branch.

Run setup-credentials.sh first, and again after switching identities.
EOF
  exit 1
}

if [ "$#" -ne 1 ] || ! [[ "$1" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]]; then usage; fi
repo="$1"

default_branch="$(gh api "repos/$repo" --jq .default_branch)"
base="$(gh api "repos/$repo/git/ref/heads/$default_branch" --jq .object.sha)"
probe="nuphos/signoff-probe-$(date +%s)-$RANDOM"

gh api "repos/$repo/git/refs" -f ref="refs/heads/$probe" -f sha="$base" >/dev/null
trap 'gh api -X DELETE "repos/$repo/git/refs/heads/$probe" >/dev/null 2>&1 || echo "warning: could not delete branch $probe" >&2' EXIT

jq -n --arg repo "$repo" --arg branch "$probe" --arg base "$base" '{
  query: "mutation($input: CreateCommitOnBranchInput!) { createCommitOnBranch(input: $input) { commit { author { name email } } } }",
  variables: { input: {
    branch: { repositoryNameWithOwner: $repo, branchName: $branch },
    expectedHeadOid: $base,
    message: { headline: "Probe the commit author for a DCO sign-off" },
    fileChanges: {}
  } }
}' | gh api graphql --input - --jq '.data.createCommitOnBranch.commit.author | "\(.name)\t\(.email)"' |
  python3 -c '
import re, sys
name, _, email = sys.stdin.read().rstrip("\n").partition("\t")
if not name.strip() or re.search(r"[\x00-\x1f\x7f<>]", name):
    sys.exit("GitHub returned no usable author name; stop before committing")
if not re.fullmatch(r"[^\s<>@\x00-\x1f\x7f]+@[^\s<>@\x00-\x1f\x7f]+", email):
    sys.exit("GitHub returned no usable author email; stop before committing")
print(f"Signed-off-by: {name} <{email}>")
'
