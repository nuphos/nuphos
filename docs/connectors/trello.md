# Trello

Trello connections use Composio-managed OAuth1. Nuphos stores the connected-account
identifier and authorizing member, not a Trello API key, token or OAuth secret.
The Composio API key remains on the backend. Jira authorization is not reused.

## Server configuration

Set `NUPHOS_COMPOSIO_API_KEY` to a Composio project's API key. That turns on
every Composio connector, Trello included; there is no separate Trello switch.
The backend uses the project's oldest Composio-managed Trello auth config, and
creates one when the project has none. Connections use the hosted Connect Link
flow; legacy managed-account initiation is unsupported. No SDK or additional
secret-storage service is required.

The backend needs a public HTTPS origin, resolved like the other OAuth connectors:
`NUPHOS_PUBLIC_BACKEND_URL`, or `NUPHOS_BACKEND_URL` when that is public. The generated
Connect Link returns to `<origin>/trello-app/setup?state=…`, then opens the
`nuphos://trello-callback` application link. Completion requires the initiating
administrator's authenticated session and a one-time code. Trello always uses
this deferred completion, including when legacy connectors bind immediately.

No real Composio connection or Trello account is required for the fixture tests.
Production configuration and a human completing consent remain deployment steps;
no Trello connection is made without that consent. Never paste API keys or provider tokens into an agent conversation.

## Connecting and using an account

A team administrator chooses **Trello** in Add connector and completes Composio's
hosted authorization. The consent screen determines the grant; the catalog of
available tools is not evidence of permission to use all of them. Trello's board
membership and token permissions still apply.

The binding starts with an allow-list containing only the authorizing member.
Administrators can explicitly change that list in the connector's access editor.
An allowed member must also select the binding in the agent's credential picker.
New sessions leave Trello unselected. A shared session's execution actor and any
exchanged-token limits are checked for every operation.

The built-in `trello` skill calls the session-scoped backend execute route.
The backend resolves the saved connected account and Composio user identity;
the caller cannot submit either identity. It checks ACTIVE status, user, toolkit
and auth config before executing an allowlisted tool pinned to `20261104_00`.

Initial scope is board/list/card reads, list creation and updates, card creation
and updates, moving cards between lists, and comments. It excludes attachment
uploads, arbitrary API proxies, deletion, membership changes and token export.
Card reads use pages of at most 100 items; the skill stops after 10 pages and
reports partial results. Unknown arguments are rejected. Writes are never
retried automatically; a timeout can mean the operation succeeded upstream.

## Disconnect and failures

Disconnect deletes the saved Composio connection before removing the Nuphos
binding. If Composio cannot delete it, the binding remains available for retry.
Deleting a Composio connection is distinct from revoking the provider grant;
revoke the app in Trello's account settings if that is also required.

Missing server configuration, declined/expired authorization, inactive accounts,
ACL denial and missing session selection fail closed. Upstream response bodies
are not surfaced as errors. No alternative credential is tried after a denial.
Composio and Trello can both rate-limit requests; stop on 429 and wait before
trying again. Trello's documented key/token limits still apply.

## References

- [Composio Trello toolkit](https://docs.composio.dev/toolkits/trello)
- [Composio Trello authorization guide](https://docs.composio.dev/kb/guide/toolkits-trello)
- [Connected-account management](https://docs.composio.dev/docs/auth-configuration/connected-accounts)
- [Trello rate limits](https://developer.atlassian.com/cloud/trello/guides/rest-api/rate-limits/)
