---
name: knowledge-base
description: Search the Nuphos knowledge base, report a bad knowledge chunk, or contribute reusable knowledge through the canonical team REST API.
---

# Nuphos knowledge base

Use the bundled API script instead of the RAG bound tools:

```bash
SCRIPT=skills/knowledge-base/scripts/knowledge-api.sh
bash "$SCRIPT" "$TEAM" search '{"query":"How do I rotate an EKS credential?","top_k":5}'
bash "$SCRIPT" "$TEAM" issues @/tmp/knowledge-issue.json
bash "$SCRIPT" "$TEAM" contributions @/tmp/knowledge-entry.json
```

Canonical routes:

- `POST /teams/{teamId}/knowledge/search`
  - `{ "query": string, "top_k"?: number }`
- `POST /teams/{teamId}/knowledge/issues`
  - `{ "type": "outdated"|"incorrect"|"missing", "chunk_id": string, "detail": string }`
- `POST /teams/{teamId}/knowledge/contributions`
  - `{ "title": string, "content": string, "tags"?: string[] }`

Search before reporting an issue or contributing. Preserve returned `chunk_id`
when reporting an existing bad result. Never contribute secrets, credentials,
raw customer data, or conversation-only details. Contributions should be
reusable operational knowledge with a clear title and enough context to stand
alone. A service-unavailable response means the backend knowledge integration
is not configured; do not retry through a bound tool.
