import { getTeamMembers, getTeamsByIds } from '@/lib/identity'

import { revokeBoxStreams, revokeTeamBoxStreams } from './box-access'
import { dropFromTeamGrants, dropOwnerTeamGrants, transferTeamComputers } from './device-grants'
import { dropDeviceShareApprovals, dropMemberShareApprovals } from './local-share-store'
import { dropDeviceShareTrusts, dropMemberShareTrusts } from './local-share-trust'
import { listDevicesGrantedInTeam } from './store'

import type { DeviceAccessChanger } from './access-audit'
import type { AgentDevice } from './store'

export type MemberRevocationDeps = {
  revokeTeamBoxStreams: typeof revokeTeamBoxStreams
  listGranted: (teamId: string) => Promise<AgentDevice[]>
  revokeStreams: typeof revokeBoxStreams
  dropFromGrants: typeof dropFromTeamGrants
  dropOwnerGrants: typeof dropOwnerTeamGrants
  transferComputers: typeof transferTeamComputers
  teamOwner: (teamId: string) => Promise<string | null>
  dropApprovals: typeof dropMemberShareApprovals
  dropTrusts: typeof dropMemberShareTrusts
  memberIds: (teamId: string) => Promise<string[]>
}
const memberRevocationDeps: MemberRevocationDeps = {
  revokeTeamBoxStreams,
  listGranted: (teamId) => listDevicesGrantedInTeam(teamId),
  revokeStreams: revokeBoxStreams,
  dropFromGrants: dropFromTeamGrants,
  dropOwnerGrants: dropOwnerTeamGrants,
  transferComputers: transferTeamComputers,
  teamOwner: async (teamId) => (await getTeamsByIds([teamId]))[0]?.ownerID ?? null,
  dropApprovals: dropMemberShareApprovals,
  dropTrusts: dropMemberShareTrusts,
  memberIds: async (teamId) => (await getTeamMembers(teamId)).map((member) => member.id),
}

/**
 * For a person who left the team or was removed: closes what they have open on
 * its cloud computers and on members' computers granted in it, and drops them from
 * every grant there. Their own computers stop being granted there, closing every
 * teammate's stream on them; the team's cloud computers they owned pass to the
 * team's owner. Their approvals and trusts go so nothing carries over if they rejoin.
 * `by` is whoever removed them, or they themselves when they left.
 */
export async function revokeTeamMemberAccess(
  teamId: string,
  actorId: string,
  by: DeviceAccessChanger,
  deps: MemberRevocationDeps = memberRevocationDeps,
): Promise<void> {
  await deps.revokeTeamBoxStreams(teamId, actorId)
  const granted = await deps.listGranted(teamId).catch(() => [])
  const others = granted.filter((device) => device.userId !== actorId)
  const theirs = granted.filter((device) => device.userId === actorId)

  await deps.revokeStreams(others, [actorId], teamId)
  if (theirs.length > 0)
    await deps.revokeStreams(
      theirs,
      (await deps.memberIds(teamId)).filter((id) => id !== actorId),
      teamId,
    )
  await deps.dropFromGrants(teamId, actorId, by)
  await deps.dropOwnerGrants(teamId, actorId, by)
  const owner = await deps.teamOwner(teamId)

  if (owner && owner !== actorId) await deps.transferComputers(teamId, actorId, owner, by)
  await deps.dropApprovals(teamId, actorId)
  await deps.dropTrusts(teamId, actorId)
}

/**
 * Forgets every team's answers and trusts about one computer, for a computer
 * that is being deleted. Its id is the machine's own and survives a reinstall,
 * so leaving them would hand them to whatever registers under it next.
 */
export async function forgetDeviceShares(ownerId: string, deviceId: string): Promise<void> {
  await dropDeviceShareApprovals(ownerId, deviceId)
  await dropDeviceShareTrusts(ownerId, deviceId)
}
