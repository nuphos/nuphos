# External MCP tools

Connect an MCP client to `POST /mcp` using its authenticated session, MCP OAuth token or CLI token. A Bot's agent token (from `POST /auth/cli-tokens`) acts as that Bot and is held to its team, so its tools reach only that team and the prompts it sends are attributed to the Bot. A personal CLI token acts as its person. `nuphos_list_teams` lists the teams the caller can access. Tools cannot grant access the caller does not have.

## Select GitHub credentials and identity

Call `nuphos_list_credentials(team_id, session_id)` for available options and the current selection, then `nuphos_update_credentials` with the same team and session IDs:

```json
{
  "team_id": "<team-id>",
  "session_id": "<session-id>",
  "github_installation_ids": ["<installation-id>"],
  "personal_credential_ids": ["github"],
  "team_identity": []
}
```

These three fields mirror the conversation credential picker. Omission preserves their stored value; an explicit `[]` clears them. An absent GitHub installation selection retains all installations available to the caller, while `[]` denies all. Personal credentials must belong to the caller. `team_identity: ["github"]` selects the team App identity; `[]` restores the preference for the caller's personal identity with team fallback. Selecting a personal credential grants standalone access; it is separate from identity preference on a team installation.

The existing cloud and service ID lists still use replacement semantics: an omitted or empty list revokes that category. Other categories the tool cannot name stay unchanged. Invalid list shapes return an error; unavailable IDs are filtered by the same resolver as `PATCH /agent/conversations/:sessionId/credentials`. The effective selection is returned in `enabled_for_session` and applies to the next run. Tasks under a Bot update their Bot's shared selection.
