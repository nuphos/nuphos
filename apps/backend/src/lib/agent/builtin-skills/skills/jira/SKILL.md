---
name: jira
description: Operate on Jira issues — read, create, comment, and transition — through a Jira Cloud site the user's team has bound to Nuphos via OAuth. Use whenever the user asks to open/track/close a Jira issue, file a ticket for an incident, comment on an issue, or check issue status. Nuphos backend hands the agent a short-lived Atlassian access token + cloudId; the agent calls api.atlassian.com/ex/jira/<cloudId>/rest/api/3 directly with curl.
---

# jira

## Session isolation

Keep CLI credentials and settings inside the current session's `HOME` (`NUPHOS_SESSION_HOME`) and respect the supplied CLI config environment variables. Do not copy another session's or the runtime owner's credentials. Without `NUPHOS_SESSION_HOME`, CLI defaults may use shared runtime configuration; be aware of the affected scope.

Changing runtime-global settings is possible, but strongly discouraged unless the user understands the impact on other sessions and explicitly requests it. Explain the shared scope first; do not unset session isolation variables, write to the runtime owner's home, use a shared OS credential store, or modify shared shell startup files as routine setup. This is configuration isolation, not an OS security boundary.

Use this skill when the user wants you to read or change Jira issues on their
behalf — file a ticket for an incident, create/comment/transition an issue, or
look up issue status — using the **Jira Cloud site** their team has already
bound to Nuphos. This closes the loop: detect a problem (via the
monitoring/cloud skills) → open a Jira issue with the root cause → comment
progress → transition it to Done when the fix is verified.

## Setup

```bash
# 1. Discover the Jira sites the team has bound.
ac() { curl -sS -H "Authorization: Bearer $NUPHOS_TOKEN" "${NUPHOS_BACKEND_URL:-https://api.nuphos.ai}$1" "${@:2}"; }
ac /teams/$TEAM/jira-sites | python3 -m json.tool
# → { "sites": [ { "id": "<bindingId>", "siteName": "Acme",
#       "siteUrl": "https://acme.atlassian.net", "cloudId": "<uuid>", ... } ] }

# 2. Pick one (most teams have exactly one). Load its access token + cloudId.
BINDING=<id from step 1>
# Only source on success — a failed fetch (403/404/401) leaves no fresh env
# file, and sourcing a stale one would point later calls at the wrong site.
bash skills/jira/scripts/setup-credentials.sh "$TEAM" "$BINDING" && source ~/.jira/nuphos.env

# 3. Helper for Jira REST v3 calls (all scoped to the bound site's cloudId).
jira() {
  # usage: jira <METHOD> <path> [curl args...]
  local method="$1" path="$2"; shift 2
  curl -sS -X "$method" \
    "https://api.atlassian.com/ex/jira/$JIRA_CLOUD_ID/rest/api/3$path" \
    -H "Authorization: Bearer $JIRA_ACCESS_TOKEN" \
    -H "Accept: application/json" \
    -H "Content-Type: application/json" "$@"
}
```

If `ac /teams/$TEAM/jira-sites` returns an empty list, tell the user a team
admin needs to connect Jira first (Cloud → Integrations → Add → Jira). You
cannot bind it for them.

If `setup-credentials.sh` returns **403**, the user isn't on this binding's
access allow-list — ask a team admin to grant them access, or enable a
different site. **404** means the binding was deleted — re-list sites. The
access token is short-lived; re-run `setup-credentials.sh` if a call later
returns 401 (the backend mints a fresh one).

## Discover projects and statuses (needed before creating/transitioning)

Jira issues live under a **project** and move through **transitions** (you can't
set status directly — you apply a transition whose target is e.g. "Done").

```bash
# Projects on the site:
jira GET "/project/search" | python3 -m json.tool   # → values[].key (e.g. "ACME")

# Issue types for a project (use the type's name — e.g. "Task" — or id on create):
jira GET "/issue/createmeta?projectKeys=ACME&expand=projects.issuetypes" | python3 -m json.tool

# Available transitions for an existing issue (note the transition id):
jira GET "/issue/ACME-123/transitions" | python3 -m json.tool
```

## Create an issue

Jira descriptions use the Atlassian Document Format (ADF), not plain markdown.

```bash
read -r -d '' BODY <<'JSON'
{ "fields": {
  "project": { "key": "ACME" },
  "issuetype": { "name": "Task" },
  "summary": "<title>",
  "description": {
    "type": "doc", "version": 1,
    "content": [ { "type": "paragraph", "content": [
      { "type": "text", "text": "<what broke, affected resource, root cause, links>" } ] } ]
  }
} }
JSON
jira POST "/issue" -d "$BODY" | python3 -m json.tool
# → returns { "key": "ACME-123", "self": "...", "id": "..." } — report the key + browse URL
#   ($JIRA_SITE_URL/browse/ACME-123).
```

## Comment on an issue

```bash
jira POST "/issue/ACME-123/comment" -d '{"body":{"type":"doc","version":1,"content":[{"type":"paragraph","content":[{"type":"text","text":"deployed fix in PR #42, monitoring"}]}]}}' | python3 -m json.tool
```

## Transition an issue (e.g. move to Done)

```bash
# 1. List transitions to find the target id:
jira GET "/issue/ACME-123/transitions" | python3 -m json.tool
# 2. Apply it:
jira POST "/issue/ACME-123/transitions" -d '{"transition":{"id":"<transitionId>"}}'
# (returns 204 No Content on success)
```

## Search / list issues (JQL)

```bash
# Open issues in a project:
jira GET "/search/jql?jql=$(python3 -c 'import urllib.parse;print(urllib.parse.quote("project = ACME AND statusCategory != Done ORDER BY created DESC"))')&maxResults=25&fields=summary,status" | python3 -m json.tool

# Look up one issue:
jira GET "/issue/ACME-123?fields=summary,status,assignee" | python3 -m json.tool
```

## Safety

- **Read-only by default.** Listing projects, transitions, and issues is safe
  and needs no confirmation.
- **Confirm before mutating.** Before creating an issue, commenting, or applying
  a transition, summarize exactly what you'll do — which site + project, the
  summary/body, the target status — and ask the user, unless they already gave
  an explicit instruction ("open a Jira issue titled X", "move ACME-123 to
  Done").
- **Don't leak the token.** `JIRA_ACCESS_TOKEN` is a workspace access token;
  never echo it, never paste it into an issue body or comment. If asked "what's
  the token", say it's held in the sandbox env and not shown.
- **Match the project.** If the site has multiple projects, pick the one the
  user named; if ambiguous, list them and ask which project the issue belongs to
  rather than guessing.

## Errors

- `403` from `setup-credentials.sh` — caller not on the binding allow-list.
- `404` from `setup-credentials.sh` — site binding was removed; re-list.
- `401` from a Jira REST call — the access token lapsed mid-session; re-run
  `setup-credentials.sh` (the backend refreshes it) and `source` the env again.
  If it persists, the stored grant was revoked in Atlassian; tell the user a
  team admin needs to re-connect the site.
- `400` on create/transition — usually a bad `project.key`, `issuetype`, or
  `transition.id`; re-query createmeta/transitions and retry with valid ids.
