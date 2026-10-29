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

function conversationShell(data: ConversationTranscriptSync) {
  return upsertConversationShell({
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
}

async function recordTranscript(data: ConversationTranscriptSync, count: number, now: Date) {
  const set: Record<string, unknown> = {
    firstMessage: data.firstMessage.slice(0, 500),
    messageCount: count,
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
}

/** Makes the stored transcript exactly `data.messages`: what it omits is deleted. */
export async function syncConversationTranscriptUnlocked(
  data: ConversationTranscriptSync,
): Promise<{ isNew: boolean }> {
  const now = new Date()
  const messageIds = data.messages.map((message) => message.id)
  const shell = await conversationShell(data)

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
  await recordTranscript(data, data.messages.length, now)

  return shell
}

/**
 * Stores what a turn adds, after everything already stored. A turn's view of
 * the earlier messages is model input rebuilt from storage, and may have lost
 * parts it cannot represent (an attachment-only message, a steering receipt),
 * so it never rewrites or deletes a stored message. Returns the stored count.
 */
export async function appendTranscriptMessages(
  data: ConversationTranscriptSync,
): Promise<{ isNew: boolean; count: number }> {
  return await withTranscriptWriteLock(data.sessionId, data.userId, async () => {
    const now = new Date()
    const shell = await conversationShell(data)
    const existing = await agentMessages()
      .find(
        { sessionId: data.sessionId, userId: data.userId },
        { projection: STORED_MESSAGE_FIELDS },
      )
      .toArray()
    const storedIds = new Set(existing.map((message) => message.messageId))
    const offset = existing.reduce((next, message) => Math.max(next, message.index + 1), 0)
    const added = { ...data, messages: data.messages.filter((m) => !storedIds.has(m.id)) }
    const writes = messageWrites(added, {
      attribution: new Map(),
      runtimeToolParts: existing.flatMap((message) => message.parts ?? []),
      storedAt: new Map(),
      now,
      offset,
    })

    if (writes.length > 0) await agentMessages().bulkWrite(writes, { ordered: false })
    // By count, like getConversationMessagesHead: racing persists can leave index holes.
    const count = existing.length + added.messages.length

    await recordTranscript(data, count, now)

    return { ...shell, count }
  })
}

export async function syncConversationTranscript(
  data: ConversationTranscriptSync,
): Promise<{ isNew: boolean }> {
  return await withTranscriptWriteLock(data.sessionId, data.userId, () =>
    syncConversationTranscriptUnlocked(data),
  )
}
