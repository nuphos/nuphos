---
name: notion
description: Read and edit Notion — search the workspace, fetch page/database content, create and update pages, append blocks, create/query databases, and read/post comments — through a Notion workspace the user's team has bound to Nuphos. Use whenever the user asks to find a Notion page/doc, read a Notion database, capture notes into Notion, write up a runbook/report/incident doc in Notion, update a page, or comment on one. Nuphos backend hands the agent a Notion integration token; the agent calls api.notion.com/v1 directly with curl.
---

# notion

## Session isolation

Keep CLI credentials and settings inside the current session's `HOME` (`NUPHOS_SESSION_HOME`) and respect the supplied CLI config environment variables. Do not copy another session's or the runtime owner's credentials. Without `NUPHOS_SESSION_HOME`, CLI defaults may use shared runtime configuration; be aware of the affected scope.

Changing runtime-global settings is possible, but strongly discouraged unless the user understands the impact on other sessions and explicitly requests it. Explain the shared scope first; do not unset session isolation variables, write to the runtime owner's home, use a shared OS credential store, or modify shared shell startup files as routine setup. This is configuration isolation, not an OS security boundary.

Use this skill when the user wants you to read or change **Notion** content on
their behalf — find a doc, read a database, write up a report/runbook/incident
doc, capture notes, update a page's properties or body, or comment — using the
**Notion workspace** their team has already bound to Nuphos. This closes the
loop with the other skills: investigate a problem (monitoring/cloud) → write it
up as a Notion page or database row → keep it updated.

Anything the Notion API can do, this skill can do: it hands you a workspace
integration token and you call `https://api.notion.com/v1/*` directly.

## Setup

The bound Notion workspaces are already listed for you under **Notion integrations:** in the
credential section of the system prompt. Each line carries the `integrationId`, `label`,
`workspaceName`, and a ready-to-run `setupCommand`. Pick one (most teams have exactly one) and
run its `setupCommand` verbatim:

```bash
# 1. Load the integration's token into the env.
bash skills/notion/scripts/setup-credentials.sh <teamId> <integrationId>
source ~/.notion/nuphos.env

# 2. Helper for Notion REST calls. Notion requires the Notion-Version header.
notion() {
  # usage: notion <METHOD> <path> [curl args...]
  local method="$1" path="$2"; shift 2
  curl -sS -X "$method" "https://api.notion.com/v1${path}" \
    -H "Authorization: Bearer $NOTION_TOKEN" \
    -H "Notion-Version: ${NOTION_VERSION:-2026-03-11}" \
    -H "Content-Type: application/json" "$@"
}

# Sanity check — who is the integration (the bot) and what can it see?
notion GET /users/me | python3 -m json.tool
```

If the credential section lists no Notion integrations, tell the user a
team admin needs to connect Notion first (Cloud → Integrations → Add → Notion)
and **share the pages/databases** with the integration. You cannot bind it for
them.

If `setup-credentials.sh` returns **403**, the user isn't on this binding's
access allow-list — ask a team admin to grant them access. **404** means the
binding was deleted — re-list integrations (see the fallback below).

### Fallback: discover integrations yourself

Only if the credential section is missing or looks stale. `$TEAM` is exported in the runtime
environment.

```bash
ac() { curl -sS -H "Authorization: Bearer $NUPHOS_TOKEN" "${NUPHOS_BACKEND_URL:-https://api.nuphos.ai}$1" "${@:2}"; }
ac /teams/$TEAM/notion-integrations | python3 -m json.tool
# → { "integrations": [ { "id": "<integrationId>", "label": "Acme",
#       "workspaceName": "Acme", ... } ] }
```

> **Notion sharing model.** An integration only sees pages/databases that have
> been explicitly shared with it (in Notion: page → ••• → Connections → add the
> integration). If `search` or a `GET` returns nothing / `object_not_found`,
> the page almost certainly hasn't been shared with the integration yet — tell
> the user to share it. This is a Notion permission, not a Nuphos one.

## Find things — search

```bash
# Full-text search across shared pages + databases:
notion POST /search -d '{"query":"runbook","page_size":20}' | python3 -m json.tool

# Only data sources (the queryable tables inside databases), sorted by last edited:
notion POST /search -d '{"filter":{"property":"object","value":"data_source"},"sort":{"direction":"descending","timestamp":"last_edited_time"}}' | python3 -m json.tool

# Only pages:
notion POST /search -d '{"filter":{"property":"object","value":"page"},"query":""}' | python3 -m json.tool
```

Search returns `results[]` each with `id`, `object` (`page`/`data_source`), a
`url`, and (for pages) `properties`. Report the `url` back so the user can open
it.

> **Databases vs data sources (API ≥ 2025-09-03).** A Notion *database* is a
> container; the actual queryable table of rows + schema is a *data source*
> inside it (usually one, sometimes several). Search and `query` operate on
> **data sources**, not the database container — a `data_source` result's `id`
> is the id you query directly. Given a database id, list its data sources with
> `GET /databases/{id}` (below).

## Read a page's content — fetch

A Notion page has two parts: its **properties** (`GET /pages/{id}`) and its
**body**, which is a tree of blocks (`GET /blocks/{id}/children`).

```bash
PAGE=<page id, dashes optional>
notion GET /pages/$PAGE | python3 -m json.tool            # title + properties
notion GET "/blocks/$PAGE/children?page_size=100" | python3 -m json.tool  # body blocks
```

Blocks paginate: if the response has `"has_more":true`, pass
`start_cursor=<next_cursor>` to get the next page. Nested blocks (toggles,
columns, etc.) have their own children — recurse with `GET /blocks/{childId}/children`
when a block has `"has_children":true`.

Retrieve a single block:

```bash
notion GET /blocks/<blockId> | python3 -m json.tool
```

## Read a database — resolve the data source, then query

Schema and rows live on the **data source**, not the database container. If you
already have a `data_source` id (e.g. from `search`), skip step 1.

```bash
# 1. Resolve a database id to its data source(s). Single-source is the norm.
DB=<database id>
notion GET /databases/$DB | python3 -m json.tool
# → { "object":"database", "id":"...", "data_sources":[ { "id":"<dsId>", "name":"..." } ] }

# 2. Read the schema (property definitions) from the data source:
DS=<data source id from step 1>
notion GET /data_sources/$DS | python3 -m json.tool        # properties = schema

# 3. Query rows with a filter + sort (see Notion filter docs for the shape):
notion POST /data_sources/$DS/query -d '{
  "filter": { "property": "Status", "status": { "equals": "In progress" } },
  "sorts": [ { "property": "Priority", "direction": "descending" } ],
  "page_size": 50
}' | python3 -m json.tool
```

Each row is a page; its cells are in `properties`. Paginate with `start_cursor`
exactly like blocks.

## Create a page

Pages live either under a parent page or as a row in a database. Titles and rich
text use Notion's rich-text array shape.

```bash
# A standalone doc under a parent page, with a heading + paragraph body:
notion POST /pages -d '{
  "parent": { "page_id": "<parentPageId>" },
  "properties": { "title": { "title": [ { "text": { "content": "Incident 2026-07-08: API latency" } } ] } },
  "children": [
    { "heading_2": { "rich_text": [ { "text": { "content": "Summary" } } ] } },
    { "paragraph": { "rich_text": [ { "text": { "content": "Root cause: ..." } } ] } }
  ]
}' | python3 -m json.tool
# → returns the new page id + url. Report the url.

# A new row in a database — parent is the DATA SOURCE id (not the database id;
# resolve it via GET /databases/$DB above). Properties must match the schema.
notion POST /pages -d '{
  "parent": { "data_source_id": "<dataSourceId>" },
  "properties": {
    "Name":   { "title":  [ { "text": { "content": "Deploy rollback" } } ] },
    "Status": { "status": { "name": "In progress" } }
  }
}' | python3 -m json.tool
```

To build a longer body, prefer creating the page with a few `children` blocks
and then appending the rest (below) — a single request caps at 100 blocks.

## Add content to a page — append blocks

```bash
notion PATCH /blocks/$PAGE/children -d '{
  "children": [
    { "bulleted_list_item": { "rich_text": [ { "text": { "content": "First finding" } } ] } },
    { "code": { "language": "bash", "rich_text": [ { "text": { "content": "kubectl get pods" } } ] } }
  ]
}' | python3 -m json.tool
```

Common block types: `paragraph`, `heading_1`/`heading_2`/`heading_3`,
`bulleted_list_item`, `numbered_list_item`, `to_do`, `toggle`, `quote`,
`callout`, `code`, `divider`, `table`. Each wraps a `rich_text` array (except
`divider`).

## Update a page

```bash
# Update properties (rename, change a DB row's Status, etc.):
notion PATCH /pages/$PAGE -d '{"properties":{"Status":{"status":{"name":"Done"}}}}' | python3 -m json.tool

# Move a page to trash (delete). `in_trash` replaced `archived` in 2026-03-11.
notion PATCH /pages/$PAGE -d '{"in_trash":true}' | python3 -m json.tool

# Edit a block's text in place:
notion PATCH /blocks/<blockId> -d '{"paragraph":{"rich_text":[{"text":{"content":"revised text"}}]}}' | python3 -m json.tool

# Delete a single block:
notion DELETE /blocks/<blockId> | python3 -m json.tool
```

## Create a database

The schema now lives on a data source, so the initial schema is passed under
`initial_data_source` (API ≥ 2025-09-03):

```bash
notion POST /databases -d '{
  "parent": { "page_id": "<parentPageId>" },
  "title": [ { "text": { "content": "Incidents" } } ],
  "initial_data_source": {
    "properties": {
      "Name":     { "title": {} },
      "Status":   { "status": {} },
      "Severity": { "select": { "options": [ {"name":"low"},{"name":"high"} ] } },
      "Opened":   { "date": {} }
    }
  }
}' | python3 -m json.tool
```

The response's `data_sources[0].id` is the id you query and add rows to. To
change the schema later, patch the **data source** (not the database):
`notion PATCH /data_sources/<dataSourceId> -d '{"properties":{...}}'`.

## Comments

```bash
# Read comments on a page/block:
notion GET "/comments?block_id=$PAGE" | python3 -m json.tool

# Post a comment on a page:
notion POST /comments -d '{"parent":{"page_id":"'$PAGE'"},"rich_text":[{"text":{"content":"Deployed the fix, monitoring."}}]}' | python3 -m json.tool
```

## Users

```bash
notion GET "/users?page_size=100" | python3 -m json.tool   # list workspace users
notion GET /users/<userId> | python3 -m json.tool
```

## Safety

- **Read-only is safe.** `search`, `GET`, and database `query` need no
  confirmation.
- **Confirm before mutating.** Before creating a page/database, appending or
  editing blocks, updating properties, archiving, or commenting, summarize
  exactly what you'll do — which workspace, the parent, the title/body, the
  target property change — and ask the user, unless they already gave an
  explicit instruction ("write this up in Notion under <page>", "mark the row
  Done", "comment on <page>").
- **Trashing is destructive-ish.** `"in_trash":true` sends a page to trash.
  Only do it on explicit instruction, and report the page url so it can be
  restored.
- **Don't leak the token.** `NOTION_TOKEN` is a workspace integration token;
  never echo it, never paste it into a page or comment. If asked "what's the
  token", say it's held in the sandbox env and not shown.

## Errors

- `403` from `setup-credentials.sh` — caller not on the binding allow-list.
- `404` from `setup-credentials.sh` — binding was removed; re-list integrations.
- Notion `401 unauthorized` — the stored token was revoked; tell the user a team
  admin needs to re-connect Notion.
- Notion `404 object_not_found` — the page/database exists but hasn't been
  **shared with the integration**, or the id is wrong. Ask the user to share it
  (page → ••• → Connections), then retry.
- Notion `400 validation_error` — the body shape is wrong (e.g. a property key
  that isn't in the schema, or a bad rich-text array). Re-read the schema with
  `GET /data_sources/<dataSourceId>` and fix the payload.
- Notion `429` — rate limited; back off (respect `Retry-After`) and retry.
