#!/usr/bin/env bash
# Fails unless a commit is one the merge queue put on main: reachable from main,
# signed by GitHub, and the head of a successful merge_group run. Every release
# workflow runs this before it builds or reaches a release environment.
#
#   bash scripts/verify-release-provenance.sh <commit>
#
# Needs GH_TOKEN (actions: read), GITHUB_REPOSITORY and a full clone with origin/main.
set -euo pipefail

commit="$(git rev-parse --verify "${1:?usage: verify-release-provenance.sh <commit>}^{commit}")"
repo="${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is not set}"
fail() { echo "::error::Release commit $commit $1"; exit 1; }

git merge-base --is-ancestor "$commit" origin/main || fail "is not on main"

signer="$(gh api "repos/$repo/commits/$commit" --jq 'select(.commit.verification.verified) | .committer.login')"
[[ "$signer" == web-flow ]] || fail "is not signed by GitHub"

queued="$(gh api "repos/$repo/actions/runs?head_sha=$commit&event=merge_group&status=success" \
  --jq '[.workflow_runs[] | select(.head_branch | startswith("gh-readonly-queue/main/"))] | length')"
[[ "$queued" -gt 0 ]] || fail "did not pass the merge queue"

echo "Release commit $commit passed the merge queue onto main"
