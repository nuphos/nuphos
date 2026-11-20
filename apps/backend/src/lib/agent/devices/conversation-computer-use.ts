import { errorMessage, logEvent } from '@/lib/observability'

import { allows, deviceAccess, deviceOwner } from './box-access'
import { usableConversationComputer } from './conversation-computer'
import { teamGrant } from './device-grants'

import type { DeviceAccessDeps } from './box-access'
import type { ConversationAccessFields } from './conversation-computer'

/** A chat's computer that someone removed from the chat can still use. */
export type ComputerStillShared = { deviceId: string; label: string }

/**
 * Whether the person removed from this conversation still uses its computer by name, so the
 * owner or a manager who removed them is told. Removal never changes who uses the computer;
 * that stays with its sharing settings. Not for a computer shared with everyone, nor for its
 * owner or managers, nor when someone leaves on their own.
 */
export async function computerStillShared(
  conversation: ConversationAccessFields,
  actorId: string,
  removedId: string,
  deps?: DeviceAccessDeps,
): Promise<ComputerStillShared | null> {
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

  return { deviceId: device.deviceId, label: device.label }
}

/** The same check where it must not fail: a failed check is logged and gives no notice. */
export function computerStillSharedOrNone(
  ...args: Parameters<typeof computerStillShared>
): Promise<ComputerStillShared | null> {
  return computerStillShared(...args).catch((err: unknown) => {
    logEvent('warn', 'agent.conversation.computer_still_shared_failed', {
      error: errorMessage(err),
    })

    return null
  })
}
