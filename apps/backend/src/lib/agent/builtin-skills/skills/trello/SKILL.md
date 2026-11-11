---
name: trello
description: Read Trello boards, lists and cards; create, update, move and comment on cards through an explicitly selected team connection using Composio-managed authorization.
---

# Trello

Use only a binding listed in this conversation's selected credentials. Nuphos
checks team membership, binding ACL, active execution actor, session selection
and connected-account ownership before each call. Composio holds the Trello grant;
no provider credential or Composio API key is handed to the agent.

```bash
printf '%s' '{"idMember":"me"}' | bash skills/trello/scripts/composio.sh TEAM_ID BINDING_ID TRELLO_GET_MEMBERS_BOARDS_BY_ID_MEMBER
```

Arguments are JSON on stdin. Supported tools (version `20261104_00`):

- `TRELLO_GET_MEMBERS_BY_ID_MEMBER` (`idMember`, use `me`)
- `TRELLO_GET_MEMBERS_BOARDS_BY_ID_MEMBER` (`idMember`)
- `TRELLO_GET_BOARDS_BY_ID_BOARD`, `TRELLO_GET_BOARDS_LISTS_BY_ID_BOARD`, `TRELLO_GET_BOARDS_CARDS_BY_ID_BOARD` (`idBoard`)
- `TRELLO_GET_LISTS_CARDS_BY_ID_LIST` (`idList`)
- `TRELLO_GET_CARDS_BY_ID_CARD` (`idCard`)
- `TRELLO_ADD_LISTS`, `TRELLO_UPDATE_LISTS_BY_ID_LIST`
- `TRELLO_ADD_CARDS`, `TRELLO_UPDATE_CARDS_BY_ID_CARD`
- `TRELLO_UPDATE_CARDS_ID_LIST_BY_ID_CARD` (move a card)
- `TRELLO_ADD_CARDS_ACTIONS_COMMENTS_BY_ID_CARD` (comment)

Use the current official tool schema to supply required arguments; do not guess
field names for writes. Read before changing a card. Writes need a request for
that specific change; never create test cards or public comments. 401/403 means
stop and reconnect/check access, not try another identity. Tool availability does
not grant permissions: Trello consent and board membership still apply.

Read bounded pages (at most 100 cards per page and 10 pages); use before/limit
where the tool supports them. Stop or narrow the query at the bound, and never
claim a partial result is exhaustive. Trello limits requests per API key/token;
Composio may impose additional limits. Stop on 429 and wait; do not automatically
retry writes, including after a timeout when the outcome is unknown.

Disconnect removes the Nuphos binding and deletes its Composio connection. This
is distinct from revoking the provider grant in Trello. Do not claim that an
upstream grant was revoked unless that separate operation was verified.

Official references:
https://docs.composio.dev/toolkits/trello
https://docs.composio.dev/kb/guide/toolkits-trello
https://developer.atlassian.com/cloud/trello/guides/rest-api/rate-limits/
