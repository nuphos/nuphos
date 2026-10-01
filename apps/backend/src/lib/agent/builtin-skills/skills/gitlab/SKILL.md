---
name: gitlab
description: Operate on GitLab projects, merge requests, pipelines, and repository contents through a GitLab account the user's team has bound to Nuphos. Nuphos backend hands out the binding's short-lived OAuth token; the agent talks to the GitLab API and clones or pushes over HTTPS directly. Use whenever the user asks about their GitLab repos, MRs, CI pipelines, wants code read from a GitLab repo, or asks to open/update/comment on merge requests.
---

# gitlab

## Session isolation

Keep CLI credentials and settings inside the current session's `HOME` (`NUPHOS_SESSION_HOME`) and respect the supplied CLI config environment variables. Do not copy another session's or the runtime owner's credentials. Without `NUPHOS_SESSION_HOME`, CLI defaults may use shared runtime configuration; be aware of the affected scope.

Changing runtime-global settings is possible, but strongly discouraged unless the user understands the impact on other sessions and explicitly requests it. Explain the shared scope first; do not unset session isolation variables, write to the runtime owner's home, use a shared OS credential store, or modify shared shell startup files as routine setup. This is configuration isolation, not an OS security boundary.

Use this skill when the user wants you to interact with GitLab on their behalf — list projects, inspect merge requests or CI pipelines, read repository files, clone a repo, push branches, or open/comment on MRs — using the **GitLab account** their team has bound to Nuphos. Works for gitlab.com and self-hosted GitLab alike.

Like the github skill, the backend hands the sandbox a **short-lived access token** (~2 h, auto-refreshed server-side; fetch again on 401). The GitLab connect dialog lets users choose scopes before authorizing. Its default selection requests read access plus `write_repository` and `api`, so you can read, clone, push branches, create/update merge requests, and post MR notes when the bound GitLab account itself has permission in the target project.

Older bindings may still have only `read_api read_user read_repository`. Check the `scope` returned by `/token` or printed by `setup-credentials.sh` before mutating. If the token lacks `api` or `write_repository`, ask a team admin to reconnect the GitLab account from the desktop app so Nuphos receives the newer write-capable grant.

## Setup

The bound GitLab accounts are already listed for you under **GitLab bindings:** in the
credential section of the system prompt. Each line carries the `bindingId`, `hostUrl`,
`username`, and a ready-to-run `setupCommand`. Pick the binding whose `hostUrl` matches the
project the user is asking about and run its `setupCommand` verbatim:

```bash
bash skills/gitlab/scripts/setup-credentials.sh <teamId> <bindingId>
```

It configures git + `glab` and writes `~/.gitlab-token` for raw API calls. Then:

```bash
# Prefer the pre-installed GitLab CLI for common operations.
glab repo list --member --output json

# Raw API fallback for endpoints glab does not expose directly.
GITLAB_HOST="$(cat ~/.gitlab-host)"
gl() { curl -sS -H "Authorization: Bearer $(cat ~/.gitlab-token)" "$GITLAB_HOST/api/v4$1" "${@:2}"; }
```

If the credential section lists no GitLab bindings, tell the user a team admin needs to connect a GitLab account first (desktop app → Integrations → Add → GitLab) — you cannot bind it for them because it requires an interactive OAuth grant in their browser.

### Fallback: discover bindings yourself

Only if the credential section is missing or looks stale. `$TEAM` is exported in the runtime
environment.

```bash
# Reuse the helper from the nuphos-api skill (loads it if needed):
ac() { curl -sS -H "Authorization: Bearer $NUPHOS_TOKEN" "${NUPHOS_BACKEND_URL:-https://api.nuphos.ai}$1" "${@:2}"; }

ac /teams/$TEAM/gitlab-bindings | python3 -m json.tool
# → { "bindings": [ { "id": "...", "hostUrl": "https://gitlab.com", "username": "...", ... } ] }
```

## Common operations

```bash
# Prefer high-level commands: they handle host selection, authentication,
# pagination, and JSON formatting without rebuilding API calls by hand.
glab repo list --member --per-page 50 --output json
glab mr list --repo <group/project> --per-page 30 --output json
glab ci list --repo <group/project> --per-page 30 --output json
glab mr view <iid> --repo <group/project> --comments

# Use the raw helper for an API shape without a glab command.
# Projects the bound account can access, most recently active first.
gl "/projects?membership=true&order_by=last_activity_at&per_page=50"

# Merge requests for a project (numeric id from the project list).
gl "/projects/$PROJECT_ID/merge_requests?state=opened&per_page=30"

# One MR with diff stats; discussions/notes:
gl "/projects/$PROJECT_ID/merge_requests/$MR_IID"
gl "/projects/$PROJECT_ID/merge_requests/$MR_IID/notes?per_page=50"

# CI/CD pipelines + jobs:
gl "/projects/$PROJECT_ID/pipelines?per_page=30"
gl "/projects/$PROJECT_ID/pipelines/$PIPELINE_ID/jobs"

# Read a file without cloning (ref defaults to the default branch):
gl "/projects/$PROJECT_ID/repository/files/path%2Fto%2Ffile?ref=main" | python3 -c '
import json,sys,base64; print(base64.b64decode(json.load(sys.stdin)["content"]).decode())'

# Clone — git credentials were set up by the script:
git clone "$GITLAB_HOST/<group>/<project>.git"

# Push a branch after editing a cloned repo:
git checkout -b my-change
git push -u origin my-change

# Open an MR via API (requires the `api` scope and project permission):
PROJECT_ID=<numeric project id>
gl "/projects/$PROJECT_ID/merge_requests" \
  -X POST \
  --data-urlencode "source_branch=my-change" \
  --data-urlencode "target_branch=main" \
  --data-urlencode "title=fix: describe the change"

# Add a top-level MR note:
MR_IID=<merge request iid>
gl "/projects/$PROJECT_ID/merge_requests/$MR_IID/notes" \
  -X POST \
  --data-urlencode "body=Review note text"
```

The full GitLab REST API surface under `/api/v4` is available through the bound OAuth token. Prefer it over cloning when you only need metadata or a few files.

## Nuphos proxy fallback

The backend also proxies a small read-only subset — handy for a quick look without running setup. `/teams/$TEAM/gitlab-bindings/namespaces` (team-level, no binding id) flattens every top-level group/user namespace across all bindings with project counts; per binding there are `/teams/$TEAM/gitlab-bindings/$GB/projects?namespace=<root>`, `.../projects/:id/merge-requests`, and `.../projects/:id/pipelines`.

## Error handling

- `401` from GitLab — token expired; re-run `setup-credentials.sh`. If the backend's `/token` endpoint itself returns `401 gitlab_unauthorized`, the stored grant was revoked: tell the user to re-bind the GitLab account.
- `403` on push/write with a token that lacks `api` or `write_repository` — old read-only binding; ask a team admin to reconnect GitLab from the desktop app.
- `403` on push/write with `api`/`write_repository` present — the bound GitLab account itself lacks project permission; report the exact project and operation that failed.
- `503 gitlab_oauth_not_configured` — backend operator issue, not fixable from the app.
