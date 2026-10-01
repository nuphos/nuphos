---
name: linear
description: Operate on Linear issues — read, create, comment, and close — through a Linear workspace the user's team has bound to Nuphos via OAuth. Use whenever the user asks to open/track/close a Linear issue, file a ticket for an incident, comment on an issue, or check issue status. Nuphos backend hands the agent a workspace access token; the included stateless helpers call api.linear.app/graphql directly.
---

# linear

## Session isolation

Keep CLI credentials and settings inside the current session's `HOME` (`NUPHOS_SESSION_HOME`) and respect the supplied CLI config environment variables. Do not copy another session's or the runtime owner's credentials. Without `NUPHOS_SESSION_HOME`, CLI defaults may use shared runtime configuration; be aware of the affected scope.

Changing runtime-global settings is possible, but strongly discouraged unless the user understands the impact on other sessions and explicitly requests it. Explain the shared scope first; do not unset session isolation variables, write to the runtime owner's home, use a shared OS credential store, or modify shared shell startup files as routine setup. This is configuration isolation, not an OS security boundary.

Use this skill to read or change Linear issues through a workspace already bound
to the user's Nuphos team.

## Important execution model

Every shell tool call starts in a fresh process. Shell functions, sourced env
files, and exported variables from an earlier call do **not** persist. Never
define a `lin()` function or probe guessed token variable names. The helpers in
`skills/linear/scripts/` load `~/.linear/nuphos.env` on every invocation.

## Setup

The session's credential context normally lists each enabled Linear workspace
with an exact `setupCommand`. When it does, use that command directly. Do not
list workspaces again and do not inspect the token or test it with a separate
viewer query.

```bash
bash skills/linear/scripts/setup-credentials.sh <teamId> <bindingId>
```

Only if no Linear workspace appears in the session credential context, tell the
user to enable one for this session or have an administrator connect it under
Cloud → Integrations → Add → Linear. Do not try to discover or bind an unlisted
workspace.

The setup command writes a private env file. Never print or paste its token.

## Fast path: create and assign an issue

After setup, fetch issue-routing context with bounded, paginated GraphQL requests:

```bash
# Use English aliases when the user named someone in another script/language.
bash skills/linear/scripts/issue-context.sh 'matthew|mathew|matt'
```

This filters active users on the server by name, display name, or email, then
loads workspace teams in separate paginated queries to stay within Linear's query
complexity limit. Up to 10 pipe-separated aliases are accepted per call. Team
memberships are loaded only for a unique search match. An empty, ambiguous, or
unmatched search returns candidates with `teams: null` (not loaded); no match
falls back to all active users. Re-run with the selected member's exact email to
resolve memberships, and confirm identity rather than assigning a candidate
arbitrarily. Use it instead of
separate viewer, users, teams, membership, or token-scope calls.

Pick the team from the user's explicit request or strong conversation context.
If multiple teams remain genuinely plausible, ask rather than guessing. Do not
query workflow states or invent a priority merely to create an issue: Linear's
team defaults are sufficient unless the user requested a particular state or
priority.

Create the issue in one shell call. Put the description directly on stdin; do
not stage a markdown file just to draft it. After creating the issue,
`issue-create.sh` automatically creates an idempotent Linear attachment titled
`Nuphos session`. This puts the current session URL in Linear's native **Links**
field, not in the description. Do not manually add that URL to the description.

```bash
bash skills/linear/scripts/issue-create.sh \
  --team '<teamId>' \
  --assignee '<userId>' \
  --title '<title>' <<'MARKDOWN'
## Summary

Relevant context, evidence, links, and concrete follow-ups.
MARKDOWN
```

Optional flags are `--state <stateId>`, `--priority <0-4>`, and
`--description-file <path>`. Use them only when the user or existing context
actually specifies those values. Report the returned identifier and URL.

## Generic GraphQL helper

For reads, comments, updates, and closes, send a JSON GraphQL payload through
the stateless helper. It automatically loads the correct env file and fails on
HTTP or GraphQL errors.

```bash
bash skills/linear/scripts/graphql.sh <<'JSON'
{"query":"query($id:String!){ issue(id:$id){ id identifier title url state{name type} } }","variables":{"id":"PLA-123"}}
JSON
```

### Search open issues

```bash
bash skills/linear/scripts/graphql.sh <<'JSON'
{"query":"query($team:ID){ issues(filter:{team:{id:{eq:$team}},state:{type:{nin:[\"completed\",\"canceled\"]}}},first:25){nodes{id identifier title url state{name}}}}","variables":{"team":"<teamId>"}}
JSON
```

### Comment

```bash
bash skills/linear/scripts/graphql.sh <<'JSON'
{"query":"mutation($input:CommentCreateInput!){commentCreate(input:$input){success comment{id}}}","variables":{"input":{"issueId":"<issueId>","body":"<comment>"}}}
JSON
```

### Close or move an issue

Only query workflow states when the requested operation needs a specific state:

```bash
bash skills/linear/scripts/graphql.sh <<'JSON'
{"query":"query($team:ID){workflowStates(filter:{team:{id:{eq:$team}}}){nodes{id name type}}}","variables":{"team":"<teamId>"}}
JSON
```

Then update with the selected completed/canceled state:

```bash
bash skills/linear/scripts/graphql.sh <<'JSON'
{"query":"mutation($id:String!,$input:IssueUpdateInput!){issueUpdate(id:$id,input:$input){success issue{id identifier state{name type}}}}","variables":{"id":"<issueId>","input":{"stateId":"<stateId>"}}}
JSON
```

## Safety and errors

- Reads are safe. Before a mutation, summarize workspace/team and the intended
  change unless the user already explicitly requested it.
- Match a named team or assignee; do not silently substitute a different one.
- Never echo `LINEAR_ACCESS_TOKEN` or include it in an issue/comment.
- A setup 403 means the caller is outside the binding allow-list; ask an admin
  to grant access or enable a different workspace.
- A setup 404 means the binding was removed; ask the user to update the
  session's selected credentials.
- An authentication error from `graphql.sh` means the stored grant was revoked.
  Re-run the exact setup command once in case the backend can refresh it. If it
  still fails, ask an admin to reconnect the workspace; do not loop retries.
- `success:false` means the mutation input was rejected. Reuse
  `issue-context.sh` or query the required state, then retry once with corrected
  IDs.
