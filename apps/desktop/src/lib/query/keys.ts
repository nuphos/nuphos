/** Every query key starts with its scope, so one `invalidateQueries` on a prefix refreshes all
 *  of it. Build keys here, never inline. */
export const queryKeys = {
  team: (teamId: string) => ['team', teamId] as const,
  teamMembers: (teamId: string) => [...queryKeys.team(teamId), 'members'] as const,
  /** Under `teamMembers`, so refreshing the members refreshes this too. */
  teamMembersWithRemoved: (teamId: string) =>
    [...queryKeys.teamMembers(teamId), 'with-removed'] as const,
  /** The Chats the sidebar lists: the viewer's agents and the channels they joined. */
  agentSessions: (teamId: string) => [...queryKeys.team(teamId), 'agent-sessions'] as const,
  /** The people in one chat. */
  participants: (teamId: string, sessionId: string) =>
    [...queryKeys.team(teamId), 'participants', sessionId] as const,
  inbox: (teamId: string) => [...queryKeys.team(teamId), 'inbox'] as const,
  shareApprovals: (teamId: string) => [...queryKeys.team(teamId), 'share-approvals'] as const,
  channelMentions: (teamId: string) => [...queryKeys.team(teamId), 'channel-mentions'] as const,
  credentialOptions: (teamId: string) => [...queryKeys.team(teamId), 'credential-options'] as const,
  channel: (teamId: string, channelId: string) =>
    [...queryKeys.team(teamId), 'channel', channelId] as const,
  /** A Task's transcript as last read, so it opens without a read first. */
  task: (teamId: string, sessionId: string) =>
    [...queryKeys.team(teamId), 'task', sessionId] as const,
  /** The computers in a team the viewer manages: they sign those computers' agents in. */
  managedComputers: (teamId: string) => [...queryKeys.team(teamId), 'managed-computers'] as const,
  runtimeInstances: (teamId: string) => [...queryKeys.team(teamId), 'runtime-instances'] as const,
  runtimeQuotas: (teamId: string) => [...queryKeys.team(teamId), 'runtime-quotas'] as const,
  runtimeQuotaHistory: (teamId: string, range: string) =>
    [...queryKeys.team(teamId), 'runtime-quota-history', range] as const,
  teamUsage: (teamId: string, query: object) =>
    [...queryKeys.team(teamId), 'team-usage', query] as const,
  /** Under `runtimeInstances`, so a change to the agents reads their status again too. */
  runtimeStatus: (teamId: string, runtimeId: string) =>
    [...queryKeys.runtimeInstances(teamId), runtimeId, 'status'] as const,
  runtimeMetrics: (teamId: string, runtimeId: string, hours: number) =>
    [...queryKeys.team(teamId), 'runtime-metrics', runtimeId, hours] as const,
  runtimeFallback: (teamId: string) => [...queryKeys.team(teamId), 'runtime-fallback'] as const,
  iamPermissions: (teamId: string, provider: string, id: string, principal = '') =>
    [...queryKeys.team(teamId), 'iam', provider, id, principal] as const,
  audit: (teamId: string, ...filters: (string | boolean)[]) =>
    [...queryKeys.team(teamId), 'audit', ...filters] as const,
  memoryScope: (teamId: string, scope: string) =>
    [...queryKeys.team(teamId), 'memories', scope] as const,
  /** Under `memoryScope`, so a change marks both the live and the removed list. */
  memories: (teamId: string, scope: string, state = 'live') =>
    [...queryKeys.memoryScope(teamId, scope), state] as const,
  webhooks: (teamId: string) => [...queryKeys.team(teamId), 'webhooks'] as const,
  mcpServers: (teamId: string) => [...queryKeys.team(teamId), 'mcp-servers'] as const,
  grafanaInstances: (teamId: string) => [...queryKeys.team(teamId), 'grafana'] as const,
  /** Under `grafanaInstances`, so refreshing the bindings refreshes what was read through them. */
  grafana: (teamId: string, instanceId: string, ...rest: string[]) =>
    [...queryKeys.grafanaInstances(teamId), instanceId, ...rest] as const,
  /** A Cloudflare account's resources, e.g. `cloudflare(teamId, accountId, 'pages', name)`. */
  cloudflare: (teamId: string, accountId: string, ...resource: string[]) =>
    [...queryKeys.team(teamId), 'cloudflare', accountId, ...resource] as const,
  /** The signed-in user's vault: its devices, and its item names. */
  vault: (userId: string) => ['user', userId, 'vault'] as const,
  vaultItems: (userId: string) => [...queryKeys.vault(userId), 'items'] as const,
  /** A cloud resource list, by its `withResourceListCache` key. */
  resourceList: (cacheKey: string) => ['resource-list', cacheKey] as const,
}
