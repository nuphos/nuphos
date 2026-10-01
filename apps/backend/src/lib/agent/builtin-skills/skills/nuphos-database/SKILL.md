---
name: nuphos-database
description: Discover Nuphos-managed database connections, inspect MongoDB catalogs, and run bounded read-only queries through the canonical team REST API. Use when the user asks about a database already connected in Nuphos.
---

# Nuphos-managed databases

This skill is for database resources already connected to Nuphos. For a raw
connection string supplied by the user, use `database-cli` instead.

The canonical API keeps credentials in the backend and enforces both member
access and the connection's Agent policy. Never request or expose the stored
connection URI. Do not call `database_connections`, `database_catalog`, or
`database_query` bound tools.

```bash
SCRIPT=skills/nuphos-database/scripts/database-api.sh
bash "$SCRIPT" "$TEAM" GET
bash "$SCRIPT" "$TEAM" GET "$CONNECTION/catalog"
bash "$SCRIPT" "$TEAM" GET "$CONNECTION/catalog/collections?database=app"
bash "$SCRIPT" "$TEAM" GET "$CONNECTION/catalog/collection?database=app&collection=users"
bash "$SCRIPT" "$TEAM" POST "$CONNECTION/query/mongodb" @/tmp/query.json
```

Available conversation routes:

| Action | Call |
|---|---|
| List authorized connections | `GET /teams/{teamId}/database-connections` |
| Connection metadata | `GET …/{connectionId}` |
| Databases | `GET …/{connectionId}/catalog?refresh=false` |
| Collections | `GET …/{connectionId}/catalog/collections?database=...&refresh=false` |
| Collection detail | `GET …/{connectionId}/catalog/collection?database=...&collection=...&refresh=false` |
| Bounded MongoDB query | `POST …/{connectionId}/query/mongodb` |

Query body supports the read-only gateway's `find`, `aggregate`, `count`, and
`explain` operations. Fetch the live OpenAPI operation when the exact query
shape is needed; do not guess fields. Keep filters narrow and limits small.
Server-side JavaScript, mutations, unbounded results, and connections whose
Agent policy does not allow the requested capability are rejected and audited.

The conversation API deliberately does not expose connection creation,
credential tests, access-policy changes, monitoring administration, or
database change execution. Do not work around a 403 with a raw credential.
