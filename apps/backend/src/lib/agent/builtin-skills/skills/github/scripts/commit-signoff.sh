#!/usr/bin/env bash
# Prints the `Signed-off-by:` line for commits the current gh identity makes in
# a repository with createCommitOnBranch:
#
#   commit-signoff.sh <owner/repo>
#
# GitHub chooses the author of those commits (a member's commit email, or the
# App's <slug>[bot] address), and no read-only API returns that email. So this
# makes one empty commit on a temporary branch, reads its author, and deletes
# the branch.
set -euo pipefail

repo="${1:?usage: commit-signoff.sh <owner/repo>}"

# 1. Create a temporary branch at the tip of the default branch.
default_branch="$(gh api "repos/$repo" --jq .default_branch)"
base="$(gh api "repos/$repo/git/ref/heads/$default_branch" --jq .object.sha)"
probe="nuphos/signoff-probe-$(date +%s)-$RANDOM"
gh api "repos/$repo/git/refs" -f ref="refs/heads/$probe" -f sha="$base" >/dev/null
trap 'gh api -X DELETE "repos/$repo/git/refs/heads/$probe" >/dev/null' EXIT

# 2. Make an empty commit on it and read the author GitHub recorded.
author="$(jq -n --arg repo "$repo" --arg branch "$probe" --arg base "$base" '{
  query: "mutation($input: CreateCommitOnBranchInput!) { createCommitOnBranch(input: $input) { commit { author { name email } } } }",
  variables: { input: {
    branch: { repositoryNameWithOwner: $repo, branchName: $branch },
    expectedHeadOid: $base,
    message: { headline: "Probe the commit author" },
    fileChanges: {}
  } }
}' | gh api graphql --input - --jq '.data.createCommitOnBranch.commit.author | "\(.name) <\(.email)>"')"

# 3. Refuse anything that is not a single "Name <email>".
if ! [[ "$author" =~ ^[^\<\>[:cntrl:]]+\ \<[^\<\>[:space:]@]+@[^\<\>[:space:]@]+\>$ ]]; then
  echo "GitHub returned no usable commit author; stop before committing" >&2
  exit 1
fi
echo "Signed-off-by: $author"
