import { queryOptions } from '@tanstack/react-query'

import { api } from '../../api.ts'

import { queryKeys } from './keys.ts'

import type { TeamMember } from '../../types/team.ts'

type ReadMembers = (teamId: string, includeRemoved?: boolean) => Promise<TeamMember[]>

/** A team's members, read once for every view showing them. */
export const teamMembersQuery = (
  teamId: string,
  read: ReadMembers = (id, removed) => api.atlasListTeamMembers(id, removed),
) =>
  queryOptions({
    queryKey: queryKeys.teamMembers(teamId),
    queryFn: () => read(teamId),
    staleTime: 60_000,
  })

/** The members and the people who left, for lines that name who did something long ago. */
export const teamRosterQuery = (
  teamId: string,
  read: ReadMembers = (id, removed) => api.atlasListTeamMembers(id, removed),
) =>
  queryOptions({
    queryKey: queryKeys.teamMembersWithRemoved(teamId),
    queryFn: () => read(teamId, true),
    staleTime: 60_000,
  })
