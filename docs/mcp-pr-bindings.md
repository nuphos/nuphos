# Find Tasks bound to a pull request over MCP

Call `nuphos_find_pr_sessions` through `POST /mcp` with `team_id`, `repository` (`owner/repo`) and `number`. The result contains `bound_to`, readable `sessions` (`session_id`, title and optional agent label), and `next_cursor`. Pass the cursor unchanged to fetch the next page. The default page size is 30; `limit` can be 1–100.

This reads the existing `bind_session_resource` associations. It does not contact GitHub or infer who authored a PR. Repository matching is case insensitive; GitHub issue bindings with the same number are excluded. The caller must belong to the team and may read only conversations visible under the existing conversation access rules. Archived sessions remain searchable. An empty result means no readable binding exists, not that Nuphos did no work on the PR.

Use the returned `session_id` with `nuphos_check` to read a Task. Binding and unbinding remain the existing agent-side session-resource operations; this tool does not change a binding or grant access.
