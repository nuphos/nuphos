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
  inbox: (teamId: string) => [...queryKeys.team(teamId), 'inbox'] as const,
  shareApprovals: (teamId: string) => [...queryKeys.team(teamId), 'share-approvals'] as const,
  channelMentions: (teamId: string) => [...queryKeys.team(teamId), 'channel-mentions'] as const,
  channel: (teamId: string, channelId: string) =>
    [...queryKeys.team(teamId), 'channel', channelId] as const,
  runtimeInstances: (teamId: string) => [...queryKeys.team(teamId), 'runtime-instances'] as const,
  runtimeQuotas: (teamId: string) => [...queryKeys.team(teamId), 'runtime-quotas'] as const,
  runtimeQuotaHistory: (teamId: string, range: string) =>
    [...queryKeys.team(teamId), 'runtime-quota-history', range] as const,
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
  memories: (teamId: string, scope: string, state = 'live') =>
    [...queryKeys.team(teamId), 'memories', scope, state] as const,
  grafanaInstances: (teamId: string) => [...queryKeys.team(teamId), 'grafana'] as const,
  /** Under `grafanaInstances`, so refreshing the bindings refreshes what was read through them. */
  grafana: (teamId: string, instanceId: string, ...rest: string[]) =>
    [...queryKeys.grafanaInstances(teamId), instanceId, ...rest] as const,
  /** A cloud resource list, by its `withResourceListCache` key. */
  resourceList: (cacheKey: string) => ['resource-list', cacheKey] as const,
  /** A bucket's objects, scoped by the bucket list's key, which names the team, account and role. */
  s3Bucket: (scope: string, bucket: string) => ['aws-s3', scope, bucket] as const,
  s3Objects: (scope: string, bucket: string, prefix: string) =>
    [...queryKeys.s3Bucket(scope, bucket), 'objects', prefix] as const,
  s3Object: (scope: string, bucket: string, key: string, part: 'preview' | 'download-url') =>
    [...queryKeys.s3Bucket(scope, bucket), part, key] as const,
  /** One Lambda function's reads, scoped like `s3Bucket`. */
  lambda: (scope: string, region: string, name: string, ...part: (string | number)[]) =>
    ['aws-lambda', scope, region, name, ...part] as const,
  cloudWatchAlarm: (scope: string, arn: string, ...part: (string | number)[]) =>
    ['aws-cloudwatch-alarm', scope, arn, ...part] as const,
  /** CloudWatch metrics for one region, scoped like `s3Bucket`. */
  cloudWatchMetrics: (scope: string, region: string, ...part: (string | number)[]) =>
    ['aws-cloudwatch-metrics', scope, region, ...part] as const,
  complianceTests: (teamId: string, provider: string, integrationId: string) =>
    [...queryKeys.team(teamId), 'compliance-tests', provider, integrationId] as const,
}
