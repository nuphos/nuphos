import { useQuery } from '@tanstack/react-query'

import { teamMembersQuery } from '../lib/query/team'

import type { TeamMember } from '../types/team'

/** `teamId`'s members from the shared read; null until it lands or when it failed, and never
 *  another team's. The no-team workspace shell asks with an empty id. */
export function useTeamMemberList(teamId: string | undefined, enabled = true): TeamMember[] | null {
  const { data } = useQuery({
    ...teamMembersQuery(teamId ?? ''),
    enabled: Boolean(teamId) && enabled,
  })

  return data ?? null
}
