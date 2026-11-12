/** Every query key starts with its scope, so one `invalidateQueries` on a prefix refreshes all
 *  of it. Build keys here, never inline. */
export const queryKeys = {
  team: (teamId: string) => ['team', teamId] as const,
  teamMembers: (teamId: string) => [...queryKeys.team(teamId), 'members'] as const,
  /** Under `teamMembers`, so refreshing the members refreshes this too. */
  teamMembersWithRemoved: (teamId: string) =>
    [...queryKeys.teamMembers(teamId), 'with-removed'] as const,
  inbox: (teamId: string) => [...queryKeys.team(teamId), 'inbox'] as const,
  shareApprovals: (teamId: string) => [...queryKeys.team(teamId), 'share-approvals'] as const,
  channelMentions: (teamId: string) => [...queryKeys.team(teamId), 'channel-mentions'] as const,
  channel: (teamId: string, channelId: string) =>
    [...queryKeys.team(teamId), 'channel', channelId] as const,
}
