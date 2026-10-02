---
name: github
description: Operate on GitHub repos, issues, PRs, and Actions through a GitHub App installation the user's team has bound to Nuphos. Nuphos backend mints short-lived installation tokens; the agent talks to api.github.com directly with `gh` or `curl`. Use whenever the user names a repo, asks to read code/PRs/issues, comment, open a PR, dispatch a workflow, etc.
---

# github

## Session isolation

Keep CLI credentials and settings inside the current session's `HOME` (`NUPHOS_SESSION_HOME`) and respect the supplied CLI config environment variables. Do not copy another session's or the runtime owner's credentials. Without `NUPHOS_SESSION_HOME`, CLI defaults may use shared runtime configuration; be aware of the affected scope.

Changing runtime-global settings is possible, but strongly discouraged unless the user understands the impact on other sessions and explicitly requests it. Explain the shared scope first; do not unset session isolation variables, write to the runtime owner's home, use a shared OS credential store, or modify shared shell startup files as routine setup. This is configuration isolation, not an OS security boundary.

For Nuphos installation tokens, always use the setup script below. Do not run `gh auth login`, `gh auth switch`, or `gh auth logout`: those flows can change a shared system keychain even with `--insecure-storage`. The setup script writes the configured gh authentication file (session-scoped when supplied by the runtime) and preserves other hosts.

Use this skill when the user wants you to interact with GitHub on their behalf — read source, list/inspect/comment on PRs or issues, dispatch workflows, push branches, etc. — using the **GitHub App installation** their team has already bound to Nuphos. The agent never sees the user's personal token; Nuphos backend mints a short-lived installation access token (≤1 h) on demand.

## Setup

The bound GitHub App installations are already listed for you under **GitHub App
installations:** in the credential section of the system prompt. Each line carries the
`installationId`, `accountLogin`, `accountType`, and a ready-to-run `setupCommand`. Pick the
line whose `accountLogin` matches the org/user the requested repo lives under (most teams
have exactly one) and run its `setupCommand` verbatim:

```bash
bash skills/github/scripts/setup-credentials.sh <teamId> <installationId>
```

`gh` is pre-installed in the runtime; the script retains a fallback for outdated images.

After `setup-credentials.sh` runs, `gh` is logged in (auth lives in the session’s `$GH_CONFIG_DIR/hosts.yml`, with mode restricted to the current OS user and without using the shared system keychain, so every later `bash` tool call picks it up — no env-var dance). The token is good for ~1 hour; if any call returns 401, just re-run the setup script. For raw curl, get the current token with `gh auth token`.

If the credential section lists no GitHub App installations, tell the user a team admin needs to install the GitHub App first via the install URL (`GET /teams/$TEAM/github-installations/install-url`, admin-only) — you cannot install it for them.

If the user requested an org/repo that isn't covered by any listed installation, say so explicitly and offer to look at a different repo. **Don't try to bind a new installation yourself**; that's an admin-only flow.

### Fallback: discover installations yourself

Only if the credential section is missing or looks stale, query the backend directly. `$TEAM`
is exported in the runtime environment.

```bash
# Reuse the helper from the nuphos-api skill (loads it if needed):
ac() { curl -sS -H "Authorization: Bearer $NUPHOS_TOKEN" "${NUPHOS_BACKEND_URL:-https://api.nuphos.ai}$1" "${@:2}"; }

ac /teams/$TEAM/github-installations | python3 -m json.tool
# → { "installations": [
#       { "id": "...", "installationId": 12345678,
#         "accountLogin": "myorg", "accountType": "Organization",
#         "targetType": "selected" | "all", "createdAt": "..." } ] }
```

## What you can actually do

The token's permissions are whatever the team admin granted when they installed the App. Common shapes:

- **Read-only on selected repos** (most common) — list/read code, search PRs/issues, read Actions runs.
- **Read + write contents** — push branches, open PRs.
- **Read + write issues / PRs** — comment, label, close, request review.
- **Actions: write** — dispatch workflows, cancel runs.

Discover what's actually granted by hitting the installation metadata once:

```bash
# `ac` is the nuphos-api helper defined above; INST is the installationId from
# the credential section.
ac /teams/$TEAM/github-installations/$INST | python3 -m json.tool
# → { "installationId": ..., "accountLogin": "...",
#     "permissions": { "contents": "read", "pull_requests": "write", ... },
#     "events": [...], "suspended": false }
```

If the user asks for an action whose permission isn't there (e.g. "open a PR" but `pull_requests: read` only), tell them — Nuphos backend can't widen the scope, only the org admin can re-install the App with new permissions.

## Common operations (with `gh`)

`gh` is the easiest path; it auto-uses `GH_TOKEN`. Examples:

```bash
# --- Repos / code ---
gh repo view myorg/myrepo --json name,defaultBranchRef,description
gh api repos/myorg/myrepo/contents/path/to/file.ts --jq '.content' | base64 -d
gh search code 'TODO repo:myorg/myrepo'

# --- Pull requests ---
gh pr list --repo myorg/myrepo --state open --json number,title,author,headRefName
gh pr view 42 --repo myorg/myrepo --json title,body,files,reviews,comments
gh pr diff 42 --repo myorg/myrepo
gh pr comment 42 --repo myorg/myrepo --body "Looks good, deploying"
gh pr review 42 --repo myorg/myrepo --approve --body "LGTM"

# --- Issues ---
gh issue list --repo myorg/myrepo --label bug --json number,title,author
gh issue view 17 --repo myorg/myrepo --comments
gh issue create --repo myorg/myrepo --title "..." --body "..." --label bug

# --- Actions ---
gh run list --repo myorg/myrepo --limit 10 --json databaseId,status,conclusion,headBranch,event
gh run view <run-id> --repo myorg/myrepo --log-failed
gh workflow list --repo myorg/myrepo
gh workflow run deploy.yml --repo myorg/myrepo --ref main -f env=staging

# --- Releases / tags ---
gh release list --repo myorg/myrepo --limit 5
gh release view v1.2.3 --repo myorg/myrepo
```

The sandbox has `jq`. For a `gh` response, prefer the built-in
`gh ... --jq '...'` so filtering stays in one command; use standalone `jq` for
other JSON instead of adding a Python formatting call.

## Common operations (raw curl, when you need something `gh` doesn't expose)

`gh api` already covers anything the REST API can do, so prefer that over hand-rolled curl. If you really need raw curl (uncommon), pull the current token from `gh`:

```bash
gh_api() {
  curl -sS \
    -H "Authorization: Bearer $(gh auth token)" \
    -H "Accept: application/vnd.github+json" \
    -H "X-GitHub-Api-Version: 2022-11-28" \
    "https://api.github.com$1" "${@:2}"
}

gh_api /repos/myorg/myrepo | python3 -m json.tool
gh_api /repos/myorg/myrepo/branches | python3 -m json.tool
gh_api -X POST /repos/myorg/myrepo/issues/42/comments \
  -d '{"body":"deployed to staging"}' | python3 -m json.tool
```

## Pushing code / opening PRs

Use GitHub's `createCommitOnBranch` GraphQL mutation with the selected App installation token for new commits. GitHub supplies the App author, uses its signing committer (`web-flow`), and signs the commit. A local `git commit` followed by `git push` does **not** gain a signature from the push credentials, even when its email links to the bot.

1. Run the selected installation's setup command with `--for-commit` appended. It prints the current authenticated Nuphos participant's `Co-authored-by` trailer. Refresh this on every committing turn; never infer the participant from the runtime/provider account, installation owner, or durable conversation owner. If the participant identity is unavailable, stop before committing.
2. Work from the target branch's current SHA. For a new PR, create a new branch at the base branch SHA using `gh api repos/OWNER/REPO/git/refs -f ref=refs/heads/BRANCH -f sha=BASE_SHA`.
3. Prepare a JSON payload file for the mutation below. Include the complete new contents of each changed file as base64 in `fileChanges.additions`; include removed paths in `fileChanges.deletions`. Omit unchanged files. Add the participant and runtime trailers to `message.body`, after a blank line.
4. Submit with `gh api graphql --input /path/to/commit.json`. Use `expectedHeadOid` to prevent overwriting concurrent changes; on a mismatch, fetch and reconcile before retrying.
5. Verify the returned commit through `gh api repos/OWNER/REPO/commits/SHA`: require `.commit.verification.verified == true`, check the resolved bot author, and inspect co-authors. If verification fails, stop and report it; never bypass branch protection.
6. Fetch the branch to align the local checkout before further edits, then open the PR ready for review.

Example payload structure (replace placeholders and omit empty additions/deletions):

```json
{
  "query": "mutation($input: CreateCommitOnBranchInput!) { createCommitOnBranch(input: $input) { commit { oid url } } }",
  "variables": {
    "input": {
      "branch": { "repositoryNameWithOwner": "OWNER/REPO", "branchName": "BRANCH" },
      "expectedHeadOid": "CURRENT_BRANCH_SHA",
      "message": {
        "headline": "fix: describe the change",
        "body": "Context.\n\nCo-authored-by: PARTICIPANT_NAME <PARTICIPANT_EMAIL>\nCo-authored-by: codex <codex@openai.com>"
      },
      "fileChanges": {
        "additions": [{ "path": "path/to/file", "contents": "BASE64_COMPLETE_FILE" }]
      }
    }
  }
}
```

This API does not expose file modes, symlinks, or submodules. If the change needs those, stop and choose a signing-capable workflow rather than silently converting them to regular files. For unsigned commits already published on a PR branch, appending a signed commit does not sign its ancestors; prepare a replacement branch from the base, or obtain explicit authorization for a signed history rewrite.

A few rules:

- Always work on a **new branch**, never push to `main` / `master` / `release/*`.
- **Open the PR ready for review — not a draft.** A PR you open is a request for a human to look at the change, so `gh pr create` with no `--draft` is the default. Reach for `--draft` in exactly two cases:
  - The user asked for a draft ("open it as a draft", "don't ping the reviewers yet", "just park the branch").
  - The branch does not yet do what was asked: something is stubbed or `TODO`, a check you ran is failing and you haven't fixed it, or you're stopping partway and intend to push more commits to that same branch before a human should read it.
- Uncertainty is **not** a reason to draft. "I'm not sure this is the right approach", "the repo has no tests so I couldn't verify", "the user may want it done differently" — open the PR ready for review and write the doubt into the PR body, where a reviewer can act on it. A draft with a finished branch inside just delays the review the user asked for.
- If you did open a draft and then finished the work in the same session, flip it with `gh pr ready <number> --repo myorg/myrepo` and say so.
- Let GitHub set the App author and its signing committer. Do not hardcode a bot slug/email, supply custom author/committer fields, or substitute local unsigned commits. This works with self-hosted installations' own Apps without identity configuration.
- Add the participant trailer printed by setup and exactly one runtime trailer, separated from the body by a blank line. Select by the runtime executing this turn, not the model name or installed CLI binaries:
  - Claude Code: `Co-authored-by: claude <noreply@anthropic.com>`
  - Codex: `Co-authored-by: codex <codex@openai.com>`
- Avoid duplicate trailers and preserve legitimate existing co-authors when carrying work forward. A participant email links to a GitHub profile only if registered there; report an unlinked co-author without substituting a different email.
- If the repo has CODEOWNERS or required reviews, mention that the PR will need a human reviewer — `gh` will not bypass branch protection.

## Safety

- **Read-only by default.** `gh repo view`, `gh pr view`, `gh issue view`, `gh run list/view`, `gh search` are all safe.
- **Confirm before mutating.** Before `gh pr create`, `gh pr merge`, `gh issue close/edit`, `gh release create/delete`, `gh workflow run`, or any push, summarize the exact change (which repo, which branch, which file, which workflow + inputs) and ask the user.
- **Never force-push.** No `git push --force` / `--force-with-lease`, no rewriting published history, no `gh pr merge --rebase` on a PR with review history unless the user explicitly asked.
- **Never merge to a default branch on the user's behalf** unless they explicitly said "merge it" naming the PR — getting that wrong is hard to undo.
- **Don't leak the installation token.** `gh auth token` will print the current value; never `echo` it, never paste it into a PR body, comment, or commit, never embed it in a workflow file or repo secret. If the user asks "what's the token", say it's a short-lived installation token held inside `gh`'s auth store in the sandbox and will expire within the hour.
- **Workflows can be destructive.** `gh workflow run deploy.yml -f env=production` ships code to prod. Treat dispatching any workflow named `deploy*`, `release*`, `publish*` like a deploy: confirm the inputs (especially `env`/`environment`) before sending.
- **Branch protection / required checks.** If a PR can't be merged because checks are red or reviews are missing, surface that to the user with the exact failing check names — don't override.

## Errors

- `404 github_installation_not_found` from Nuphos backend — the installation was uninstalled or transferred. Re-list installations and tell the user.
- `401 Bad credentials` from api.github.com (or `gh: HTTP 401`) — token expired (1 h max). Re-run `setup-credentials.sh`.
- `403 Resource not accessible by integration` — the App lacks that permission for this repo/installation. Don't retry; tell the user the missing permission and suggest the org admin re-install the App with broader scope.
- `404 Not Found` on a repo path — either the repo doesn't exist or it's outside the App's `selected` repository scope. Confirm with the user which repo they meant.
- `429` / secondary rate limits — slow down (don't retry tightly). Installation tokens get their own rate limit pool, but heavy fan-out can still hit it.
