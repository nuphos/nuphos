import { canReply, conversationAccess, isParticipant } from '@/lib/agent/db/access'
import { AppError } from '@/lib/errors'

import { deviceAccessDeps, requireDeviceAccess } from './box-access'
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

/** The fields to project for resolveConversationAccess. */
export const CONVERSATION_ACCESS_PROJECTION = {
  userId: 1,
  teamId: 1,
  runtimeId: 1,
  generalAccess: 1,
  participantIds: 1,
} as const

/**
 * The computer a conversation runs on, when the person may use it in the
 * conversation's team; null when they may not. Undefined when it runs on none:
 * a team runtime serves every member.
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

/** Whether the viewer is a participant who may use the conversation's computer. */
async function participantUsesComputer(
  conversation: ConversationAccessFields,
  viewerId: string,
  deps: DeviceAccessDeps,
): Promise<boolean> {
  return (
    conversation.userId !== viewerId &&
    isParticipant(conversation, viewerId) &&
    (await usableConversationComputer(conversation, viewerId, deps)) !== null
  )
}

/**
 * What the viewer may do in the conversation. A participant replies while they
 * may use its computer, so losing the computer loses reply but keeps read.
 */
export async function resolveConversationAccess(
  conversation: ConversationAccessFields,
  viewerId: string,
  deps: DeviceAccessDeps = deviceAccessDeps,
): Promise<ConversationAccess | null> {
  return conversationAccess(
    conversation,
    viewerId,
    await participantUsesComputer(conversation, viewerId, deps),
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
  const asked = new Map<string, Promise<boolean>>()

  return Promise.all(
    conversations.map(async (conversation) => {
      if (conversation.userId === viewerId || !isParticipant(conversation, viewerId))
        return conversationAccess(conversation, viewerId, false)
      const key = `${conversation.teamId ?? ''} ${conversation.runtimeId ?? ''}`
      let uses = asked.get(key)

      if (!uses) {
        uses = participantUsesComputer(conversation, viewerId, deps)
        asked.set(key, uses)
      }

      return conversationAccess(conversation, viewerId, await uses)
    }),
  )
}
