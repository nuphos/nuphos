---
name: instructions
description: List, add, edit, disable, or delete the user's personal and the team's shared Nuphos Instructions (standing markdown guidance injected into every conversation, like CLAUDE.md) through the canonical team REST API.
---

# Nuphos Instructions

Instructions are the snippets configured in Settings > Instructions. Enabled
snippets are injected at the start of every new conversation: team snippets
first, then the user's personal snippets. Use the bundled script; do not call
the `*_instruction` bound tools.

```bash
SCRIPT=skills/instructions/scripts/instructions-api.sh
bash "$SCRIPT" "$TEAM" GET
bash "$SCRIPT" "$TEAM" POST '' @/tmp/instruction.json
bash "$SCRIPT" "$TEAM" PATCH "$INSTRUCTION_ID" '{"enabled":false}'
bash "$SCRIPT" "$TEAM" DELETE "$INSTRUCTION_ID"
```

All routes start with `/teams/{teamId}/instructions`:

- `GET /` returns `{ team, personal, canManageTeam, limits }`.
- `POST /` creates `{ "scope": "team"|"personal", "title": string, "content": string, "enabled"?: boolean }`.
- `PATCH /{id}` updates any of `title`, `content`, `enabled`.
- `DELETE /{id}` removes the snippet.

`personal` snippets apply only to the current user. `team` snippets apply to
every member and can only be changed when `canManageTeam` is true
(administrators). A title is at most 120 characters and content at most 8,000;
each scope holds at most 20 snippets totalling 24,000 characters.

Always list first, then confirm the exact wording and scope with the user
before writing: these snippets steer every future conversation. Prefer
disabling over deleting when the user only wants to pause one. Never store
secrets, tokens, or credentials in an instruction. Changes apply from the next
conversation. Only a turn started by the user can change instructions; trigger,
scheduled, and automation turns are read-only.
