import { allows, deviceAccess, deviceOwner } from './box-access'
import { usableConversationComputer } from './conversation-computer'
import { auditEach, teamGrant } from './device-grants'

import type { DeviceAccessChanger } from './access-audit'
import type { DeviceAccessDeps } from './box-access'
import type { ConversationAccessFields } from './conversation-computer'
import type { AgentDevice } from './store'

/** A computer someone removed from a chat may still use, which the remover can stop. */
export type ComputerStillShared = { deviceId: string; label: string }

/**
 * Whether the person removed from this conversation still uses its computer by name, so its
 * owner or a manager may be offered to stop that too. Not for a computer shared with everyone
 * (one person cannot be taken off it), nor for its owner or managers. Nothing records why they
 * were given use (a chat invite or the Share dialog), so this is offered, never done for them.
 */
export async function computerStillShared(
  conversation: ConversationAccessFields,
  actorId: string,
  removedId: string,
  deps?: DeviceAccessDeps,
): Promise<{ device: AgentDevice; offer: ComputerStillShared } | null> {
  const teamId = conversation.teamId

  if (!teamId || removedId === actorId) return null
  const device = await usableConversationComputer(conversation, actorId, deps)

  if (!device || !allows(deviceAccess(device, actorId, teamId), 'manage')) return null
  const grant = teamGrant(device, teamId)

  if (
    !grant ||
    grant.everyone ||
    !grant.userIds.includes(removedId) ||
    grant.managerIds.includes(removedId) ||
    deviceOwner(device) === removedId
  )
    return null

  return { device, offer: { deviceId: device.deviceId, label: device.label } }
}

/**
 * Takes one person off a computer's use in a team, leaving everyone else: one update, so a
 * Share dialog saved at the same moment is not overwritten, and audited like every grant change.
 * False when they were not on it by name (or now manage it).
 */
export async function dropTeamUse(
  device: AgentDevice,
  teamId: string,
  userId: string,
  by: DeviceAccessChanger,
): Promise<boolean> {
  const changed = await auditEach(
    teamId,
    by,
    {
      userId: device.userId,
      deviceId: device.deviceId,
      access: {
        $elemMatch: { teamId, everyone: false, userIds: userId, managerIds: { $ne: userId } },
      },
    },
    { $pull: { 'access.$[grant].userIds': userId } },
    (grant) => ({
      everyone: grant.everyone,
      userIds: grant.userIds.filter((id) => id !== userId),
      managerIds: grant.managerIds,
    }),
    [{ 'grant.teamId': teamId }],
  )

  return changed > 0
}
