import { getTeamMembers } from '@/lib/identity'

import { revokeBoxStreams, revokeTeamBoxStreams } from './box-access'
import {
  dropFromTeamDeviceShares,
  dropMemberShareApprovals,
  dropOwnerTeamDeviceShares,
  listDevicesSharedInTeam,
} from './local-share-store'
import { dropMemberShareTrusts } from './local-share-trust'
import { dropFromTeamBoxAccess } from './store'

import type { AgentDevice } from './store'

export type MemberRevocationDeps = {
  revokeTeamBoxStreams: typeof revokeTeamBoxStreams
  dropFromTeamBoxAccess: typeof dropFromTeamBoxAccess
  listShared: (teamId: string) => Promise<AgentDevice[]>
  revokeStreams: typeof revokeBoxStreams
  dropFromShares: typeof dropFromTeamDeviceShares
  dropOwnerShares: typeof dropOwnerTeamDeviceShares
  dropApprovals: typeof dropMemberShareApprovals
  dropTrusts: typeof dropMemberShareTrusts
  memberIds: (teamId: string) => Promise<string[]>
}
const memberRevocationDeps: MemberRevocationDeps = {
  revokeTeamBoxStreams,
  dropFromTeamBoxAccess,
  listShared: (teamId) => listDevicesSharedInTeam(teamId),
  revokeStreams: revokeBoxStreams,
  dropFromShares: dropFromTeamDeviceShares,
  dropOwnerShares: dropOwnerTeamDeviceShares,
  dropApprovals: dropMemberShareApprovals,
  dropTrusts: dropMemberShareTrusts,
  memberIds: async (teamId) => (await getTeamMembers(teamId)).map((member) => member.id),
}

/**
 * For a person who left the team or was removed: closes what they have open on
 * its Boxes and on members' computers shared in it, and drops them from both lists.
 * Their own computers stop being shared there too, closing every teammate's
 * stream on them, and their approvals and trusts go so nothing carries over if they rejoin.
 */
export async function revokeTeamMemberAccess(
  teamId: string,
  actorId: string,
  deps: MemberRevocationDeps = memberRevocationDeps,
): Promise<void> {
  await deps.revokeTeamBoxStreams(teamId, actorId)
  await deps.dropFromTeamBoxAccess(teamId, actorId)
  const shared = await deps.listShared(teamId).catch(() => [])
  const others = shared.filter((device) => device.userId !== actorId)
  const theirs = shared.filter((device) => device.userId === actorId)

  await deps.revokeStreams(others, [actorId], teamId)
  if (theirs.length > 0)
    await deps.revokeStreams(
      theirs,
      (await deps.memberIds(teamId)).filter((id) => id !== actorId),
      teamId,
    )
  await deps.dropFromShares(teamId, actorId)
  await deps.dropOwnerShares(teamId, actorId)
  await deps.dropApprovals(teamId, actorId)
  await deps.dropTrusts(teamId, actorId)
}

/** When administrators turn sharing off: every teammate's open stream on a shared computer closes. */
export async function revokeAllTeamDeviceShares(
  teamId: string,
  memberIds: string[],
): Promise<void> {
  const shared = await listDevicesSharedInTeam(teamId).catch(() => [])

  await Promise.all(
    shared.map((device) =>
      revokeBoxStreams(
        [device],
        memberIds.filter((id) => id !== device.userId),
        teamId,
      ),
    ),
  )
}
