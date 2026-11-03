import type { AgentDevice } from '../../api/device-types.ts'
import type { TeamMember } from '../../types/team.ts'

/**
 * Whose a computer is when it is someone else's, as the device list names it. Null for the
 * viewer's own, and for a list from a backend that does not name owners.
 */
export function computerOwner(device: Pick<AgentDevice, 'access' | 'ownerUserId'>): string | null {
  return device.access !== 'owner' && device.ownerUserId ? device.ownerUserId : null
}

/** The owner as the team knows them: their email, else their name; null until members load. */
export function ownerName(ownerId: string, members: readonly TeamMember[] | null): string | null {
  const owner = members?.find((member) => member.id === ownerId)

  return owner ? owner.email || owner.name || owner.username : null
}
