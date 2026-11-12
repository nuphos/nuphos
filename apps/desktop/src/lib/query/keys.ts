/** Every query key starts with its scope, so one `invalidateQueries` on a prefix refreshes all
 *  of it. Build keys here, never inline. */
export const queryKeys = {
  team: (teamId: string) => ['team', teamId] as const,
  teamMembers: (teamId: string) => [...queryKeys.team(teamId), 'members'] as const,
  /** Under `teamMembers`, so refreshing the members refreshes this too. */
  teamMembersWithRemoved: (teamId: string) =>
    [...queryKeys.teamMembers(teamId), 'with-removed'] as const,
}
