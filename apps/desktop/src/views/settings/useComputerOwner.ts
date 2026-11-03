import { useTeamMemberList } from '../../hooks/useTeamMemberList'

import { computerOwner, ownerName } from './computerOwner'

import type { AgentDevice } from '../../api/device-types'

/** Whose a computer is when it is someone else's, and how the team knows them; null for the viewer's own. */
export function useComputerOwner(teamId: string, device: AgentDevice) {
  const id = computerOwner(device)
  // The one shared read of the team's members, only once there is an owner to name.
  const members = useTeamMemberList(teamId, id !== null)

  return id ? { id, name: ownerName(id, members) } : null
}
