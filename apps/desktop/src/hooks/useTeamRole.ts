import { useTeamMembers } from '../lib/bindingAccess'

import { useCurrentUser } from './useCurrentUser'

import type { TeamRole } from '../types'

/** The signed-in user's role in this team; undefined while its members load. */
export function useTeamRole(teamId: string | undefined): TeamRole | undefined {
  const me = useCurrentUser()

  return useTeamMembers(teamId ?? '').find((member) => member.id === me?.id && !member.removedAt)
    ?.role
}
