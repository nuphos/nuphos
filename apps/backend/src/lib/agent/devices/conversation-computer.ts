import { canReply, conversationAccess } from '@/lib/agent/db/access'
import { AppError } from '@/lib/errors'

import { allows, deviceAccess, deviceAccessDeps, requireDeviceAccess } from './box-access'
import { parseLocalRuntimeId } from './local-runtime/address'

import type { DeviceAccessDeps } from './box-access'
import type { ConversationAccess, ReadGrants } from '@/lib/agent/db/access'
import type { AgentDevice } from './store'

/** What deciding a viewer's access reads of a conversation. */
export type ConversationAccessFields = ReadGrants & {
  userId: string
  teamId?: string
  runtimeId?: string
}

/**
 * The computer a conversation runs on, when the person may use it in the
 * conversation's team; null when they may not. Undefined when it runs on no
 * one's computer (a managed, self-hosted or development runtime), which serves
 * every member.
 */
export async function usableConversationComputer(
  conversation: ConversationAccessFields,
  userId: string,
  deps: DeviceAccessDeps = deviceAccessDeps,
): Promise<AgentDevice | null | undefined> {
  const ref = conversation.runtimeId ? parseLocalRuntimeId(conversation.runtimeId) : undefined

  if (!ref) return undefined
  try {
    const device = await requireDeviceAccess(userId, conversation.teamId, ref.deviceId, 'use', deps)

    return device.userId === ref.userId ? device : null
  } catch (error) {
    if (error instanceof AppError && error.status < 500) return null
    throw error
  }
}

/**
 * Who among these people cannot use the computer the conversation runs on (or
 * would, on `runtimeId`), and whether `actorId` may give them `use` of it, as
 * its owner or a manager. Undefined when nobody is missing it.
 */
export async function computerUseGap(
  conversation: ConversationAccessFields,
  actorId: string,
  peopleIds: string[],
  deps: DeviceAccessDeps = deviceAccessDeps,
): Promise<{ computer: AgentDevice | null; needing: string[]; canGrant: boolean } | undefined> {
  const usable = await Promise.all(
    peopleIds.map((id) => usableConversationComputer(conversation, id, deps)),
  )
  const needing = peopleIds.filter((_, index) => usable[index] === null)

  if (needing.length === 0) return undefined
  const computer = (await usableConversationComputer(conversation, actorId, deps)) ?? null
  const canGrant =
    computer !== null && allows(deviceAccess(computer, actorId, conversation.teamId), 'manage')

  return { computer, needing, canGrant }
}

/**
 * Whether the viewer may use the computer the conversation runs on; undefined
 * when it runs on no one's computer or is their own conversation.
 */
async function usesComputer(
  conversation: ConversationAccessFields,
  viewerId: string,
  deps: DeviceAccessDeps,
): Promise<boolean | undefined> {
  if (conversation.userId === viewerId) return undefined
  const computer = await usableConversationComputer(conversation, viewerId, deps)

  return computer === undefined ? undefined : computer !== null
}

/**
 * What the viewer may do in the conversation. Whoever may use its computer
 * replies, invited or not; losing the computer leaves an invitee reading only.
 */
export async function resolveConversationAccess(
  conversation: ConversationAccessFields,
  viewerId: string,
  deps: DeviceAccessDeps = deviceAccessDeps,
): Promise<ConversationAccess | null> {
  return conversationAccess(
    conversation,
    viewerId,
    await usesComputer(conversation, viewerId, deps),
  )
}

/** Whether the viewer may send, steer and answer in the conversation. */
export async function canReplyIn(
  conversation: ConversationAccessFields,
  viewerId: string,
): Promise<boolean> {
  return canReply(await resolveConversationAccess(conversation, viewerId))
}

/** resolveConversationAccess for a page of conversations, asking about each computer once. */
export async function resolveConversationAccessList(
  conversations: ConversationAccessFields[],
  viewerId: string,
  deps: DeviceAccessDeps = deviceAccessDeps,
): Promise<(ConversationAccess | null)[]> {
  const asked = new Map<string, Promise<boolean | undefined>>()

  return Promise.all(
    conversations.map(async (conversation) => {
      if (conversation.userId === viewerId) return 'owner'
      const key = `${conversation.teamId ?? ''} ${conversation.runtimeId ?? ''}`
      let uses = asked.get(key)

      if (!uses) {
        uses = usesComputer(conversation, viewerId, deps)
        asked.set(key, uses)
      }

      return conversationAccess(conversation, viewerId, await uses)
    }),
  )
}
