#!/usr/bin/env bash
# Opens (or refreshes) the pull request for a tested dependency update.
#
#   open-update-pr.sh <branch> <title> <path>...
#
# Paths are relative to the repository root. main only takes signed commits
# through a pull request, so the commit is created with the GraphQL API, which
# signs it, on a branch reset to the tested commit. Merging the pull request
# releases it: runtime-release.yml tags the new package.json version.
set -euo pipefail

branch="$1"
title="$2"
shift 2
repo="$GITHUB_REPOSITORY"
base="$(git rev-parse HEAD)"
root="$(git rev-parse --show-toplevel)"

if ! gh api -X PATCH "repos/$repo/git/refs/heads/$branch" -f sha="$base" -F force=true >/dev/null 2>&1; then
  gh api "repos/$repo/git/refs" -f ref="refs/heads/$branch" -f sha="$base" >/dev/null
fi

additions='[]'
for path in "$@"; do
  additions=$(jq -c --arg path "$path" --arg contents "$(base64 -w0 "$root/$path")" \
    '. + [{path: $path, contents: $contents}]' <<<"$additions")
done
jq -n --arg repo "$repo" --arg branch "$branch" --arg base "$base" --arg title "$title" --argjson additions "$additions" '{
  query: "mutation($input: CreateCommitOnBranchInput!) { createCommitOnBranch(input: $input) { commit { oid } } }",
  variables: { input: {
    branch: { repositoryNameWithOwner: $repo, branchName: $branch },
    expectedHeadOid: $base,
    message: { headline: $title },
    fileChanges: { additions: $additions }
  } }
}' | gh api graphql --input - >/dev/null

body="Opened by the [$GITHUB_WORKFLOW run]($GITHUB_SERVER_URL/$repo/actions/runs/$GITHUB_RUN_ID) after the update passed its tests and image smoke test. Merging it releases the new runtime version."
existing="$(gh pr list --repo "$repo" --head "$branch" --state open --json number --jq '.[0].number // empty')"
if [[ -n "$existing" ]]; then
  gh pr edit "$existing" --repo "$repo" --title "$title" --body "$body"
else
  gh pr create --repo "$repo" --base main --head "$branch" --title "$title" --body "$body"
fi
