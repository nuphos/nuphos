import { fallbackTitle } from '../title-fallback'

import { upsertConversationShell } from './conversations'
import { agentConversations, agentMessages, withTeamScope } from './shared'
import { messageWrites, STORED_MESSAGE_FIELDS } from './transcript-message-writes'
import { withTranscriptWriteLock } from './transcript-write-lock'

import type { AgentConversation, AgentMessage } from './shared'
import type { ConversationTranscriptSync } from './transcript-types'
import type { MessageMetadata } from '@/lib/agent/message-metadata'

/**
 * First `count` stored messages in transcript order. Reads by COUNT
 * (sort+limit), never by index arithmetic — racing persists can leave holes
 * in the stored index sequence, and `index < count` would then come up short
 * on every retry. The guard matters: Mongo treats `limit(0)` as unlimited.
 */
export async function getConversationMessagesHead(
  sessionId: string,
  userId: string,
  count: number,
): Promise<AgentMessage[]> {
  if (count <= 0) return []

  return await agentMessages().find({ sessionId, userId }).sort({ index: 1 }).limit(count).toArray()
}

export type { ConversationTranscriptSync } from './transcript-types'

export async function syncConversationTranscriptUnlocked(
  data: ConversationTranscriptSync,
): Promise<{ isNew: boolean }> {
  const now = new Date()
  const messageIds = data.messages.map((message) => message.id)
  const shell = await upsertConversationShell({
    sessionId: data.sessionId,
    userId: data.userId,
    teamId: data.teamId,
    title: data.preserveTitle ? '' : data.title,
    firstMessage: data.firstMessage,
    locale: data.locale,
    provider: data.provider,
    source: data.source,
    trigger: data.trigger,
    client: data.client,
    credentialAccess: data.credentialAccess,
    agentRuntime: data.agentRuntime,
    runtimeId: data.runtimeId,
    runtimeLabel: data.runtimeLabel,
  })

  let runtimeToolParts: unknown[] = []
  // Stored docs already at their incoming index; rewriting an identical one is
  // most of a long conversation's turn (every message, every send).
  const storedAt = new Map<number, AgentMessage>()
  const attribution = new Map<
    string,
    { metadata: MessageMetadata; role: 'user' | 'assistant'; parts: unknown[] }
  >()

  if (data.messages.length === 0) {
    await agentMessages().deleteMany({
      sessionId: data.sessionId,
      userId: data.userId,
    })
  } else {
    const incomingMessageIds = new Set(messageIds)
    const incomingMessageIdByIndex = new Map(
      data.messages.map((message, index) => [index, message.id]),
    )
    const incomingIndexByMessageId = new Map(
      data.messages.map((message, index) => [message.id, index]),
    )
    const existingMessages = await agentMessages()
      .find(
        { sessionId: data.sessionId, userId: data.userId },
        { projection: STORED_MESSAGE_FIELDS },
      )
      .toArray()

    for (const message of existingMessages) {
      if (message.metadata)
        attribution.set(message.messageId, {
          metadata: message.metadata,
          role: message.role,
          parts: message.parts,
        })
    }
    runtimeToolParts = existingMessages.flatMap((message) => message.parts ?? [])
    const staleDocumentIds = existingMessages.flatMap((message) => {
      if (!message._id) return []
      const incomingMessageId = incomingMessageIdByIndex.get(message.index)
      const incomingIndex = incomingIndexByMessageId.get(message.messageId)
      const stale =
        message.index >= data.messages.length ||
        !incomingMessageIds.has(message.messageId) ||
        incomingMessageId !== message.messageId ||
        incomingIndex !== message.index

      if (!stale) storedAt.set(message.index, message)

      return stale ? [message._id] : []
    })

    if (staleDocumentIds.length > 0) {
      await agentMessages().deleteMany({ _id: { $in: staleDocumentIds } })
    }
  }

  const writes = messageWrites(data, { attribution, runtimeToolParts, storedAt, now })

  if (writes.length > 0) await agentMessages().bulkWrite(writes, { ordered: false })

  const set: Record<string, unknown> = {
    firstMessage: data.firstMessage.slice(0, 500),
    messageCount: data.messages.length,
    transcriptUpdatedAt: now,
    lastActiveAt: now,
    ...(data.teamId ? { teamId: data.teamId } : {}),
    ...(data.credentialAccess ? { credentialAccess: data.credentialAccess } : {}),
  }

  if (!data.preserveTitle) set.title = data.title || fallbackTitle(data.firstMessage)

  await agentConversations().updateOne(
    withTeamScope({ sessionId: data.sessionId, userId: data.userId }, data.teamId),
    { $set: set },
  )

  return shell
}

export async function syncConversationTranscript(
  data: ConversationTranscriptSync,
): Promise<{ isNew: boolean }> {
  return await withTranscriptWriteLock(data.sessionId, data.userId, () =>
    syncConversationTranscriptUnlocked(data),
  )
}
