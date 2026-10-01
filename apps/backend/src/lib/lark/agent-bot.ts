import { randomUUID } from 'node:crypto'

import {
  larkAgentThreads,
  larkChatMappings,
  larkProcessedEvents,
  larkReplyFeedback,
  larkUserMappings,
} from './agent-bot-store'

import type {
  LarkAgentThread,
  LarkChatMapping,
  LarkProcessedEvent,
  LarkUserMapping,
} from './agent-bot-store'

export {
  larkAgentThreads,
  larkChatMappings,
  larkPairCodes,
  larkProcessedEvents,
  larkReplyFeedback,
  larkUserMappings,
  setupLarkAgentIndexes,
} from './agent-bot-store'
export type {
  LarkAgentThread,
  LarkChatMapping,
  LarkPairCode,
  LarkProcessedEvent,
  LarkReplyFeedback,
  LarkUserMapping,
} from './agent-bot-store'
export { consumeLarkPairCode, createLarkPairCode, normalizeLarkPairCode } from './agent-bot-pairing'

// ─── Chat mappings ───────────────────────────────────────────────────────────
export async function getLarkChatMapping(
  appId: string,
  chatId: string,
): Promise<LarkChatMapping | null> {
  return await larkChatMappings().findOne({ appId, chatId, enabled: true })
}

// Any mapping for this chat regardless of enabled state — lets the receive path
// tell "never linked" (auto-link it) apart from "admin disabled it" (stay quiet).
export async function getLarkChatMappingAny(
  appId: string,
  chatId: string,
): Promise<LarkChatMapping | null> {
  return await larkChatMappings().findOne({ appId, chatId })
}

export async function listLarkChatMappings(teamId: string): Promise<LarkChatMapping[]> {
  return await larkChatMappings().find({ teamId }).sort({ updatedAt: -1 }).toArray()
}

export async function upsertLarkChatMapping(data: {
  appId: string
  chatId: string
  teamId: string
  createdBy: string
  name?: string
  enabled?: boolean
}): Promise<LarkChatMapping> {
  const now = new Date()
  const mapping = await larkChatMappings().findOneAndUpdate(
    { appId: data.appId, chatId: data.chatId },
    {
      $setOnInsert: { createdAt: now, createdBy: data.createdBy },
      $set: {
        teamId: data.teamId,
        enabled: data.enabled ?? true,
        updatedAt: now,
        ...(data.name ? { name: data.name } : {}),
      },
    },
    { upsert: true, returnDocument: 'after' },
  )

  if (!mapping) throw new Error('Failed to upsert Lark chat mapping')

  return mapping
}

export async function deleteLarkChatMapping(
  appId: string,
  chatId: string,
  teamId: string,
): Promise<boolean> {
  const result = await larkChatMappings().deleteOne({ appId, chatId, teamId })

  return result.deletedCount > 0
}

// ─── User mappings ───────────────────────────────────────────────────────────
export async function getLarkUserMapping(
  appId: string,
  teamId: string,
  larkOpenId: string,
): Promise<LarkUserMapping | null> {
  return await larkUserMappings().findOne({ appId, teamId, larkOpenId, enabled: true })
}

export async function listLarkUserMappings(teamId: string): Promise<LarkUserMapping[]> {
  return await larkUserMappings().find({ teamId }).sort({ updatedAt: -1 }).toArray()
}

// 1:1 DMs carry no chat mapping (and thus no team), so the sender's own mapping
// is the only anchor. A user in multiple teams resolves to their most-recently
// updated mapping.
export async function getLarkUserMappingByOpenId(
  appId: string,
  larkOpenId: string,
): Promise<LarkUserMapping | null> {
  return await larkUserMappings().findOne(
    { appId, larkOpenId, enabled: true },
    { sort: { updatedAt: -1 } },
  )
}

export async function upsertLarkUserMapping(data: {
  appId: string
  larkOpenId: string
  teamId: string
  nuphosUserId: string
  createdBy: string
  enabled?: boolean
}): Promise<LarkUserMapping> {
  const now = new Date()
  const mapping = await larkUserMappings().findOneAndUpdate(
    { appId: data.appId, teamId: data.teamId, larkOpenId: data.larkOpenId },
    {
      $setOnInsert: { createdAt: now, createdBy: data.createdBy },
      $set: { nuphosUserId: data.nuphosUserId, enabled: data.enabled ?? true, updatedAt: now },
    },
    { upsert: true, returnDocument: 'after' },
  )

  if (!mapping) throw new Error('Failed to upsert Lark user mapping')

  return mapping
}

export async function deleteLarkUserMapping(
  appId: string,
  teamId: string,
  larkOpenId: string,
): Promise<boolean> {
  const result = await larkUserMappings().deleteOne({ appId, teamId, larkOpenId })

  return result.deletedCount > 0
}

// ─── Event idempotency ───────────────────────────────────────────────────────
export async function claimLarkEvent(data: {
  eventId: string
  appId?: string
  chatId?: string
  threadId?: string
}): Promise<boolean> {
  const now = new Date()
  const processingExpiresAt = new Date(now.getTime() + 5 * 60_000)

  try {
    await larkProcessedEvents().insertOne({
      eventId: data.eventId,
      appId: data.appId,
      chatId: data.chatId,
      threadId: data.threadId,
      status: 'processing',
      processingExpiresAt,
      createdAt: now,
      updatedAt: now,
    })

    return true
  } catch (err) {
    if ((err as { code?: number }).code !== 11000) throw err
    const result = await larkProcessedEvents().findOneAndUpdate(
      { eventId: data.eventId, status: 'processing', processingExpiresAt: { $lt: now } },
      {
        $set: {
          appId: data.appId,
          chatId: data.chatId,
          threadId: data.threadId,
          status: 'processing',
          processingExpiresAt,
          updatedAt: now,
        },
        $unset: { error: '' },
      },
      { returnDocument: 'after' },
    )

    return result !== null
  }
}

export async function markLarkEvent(
  eventId: string,
  status: LarkProcessedEvent['status'],
  error?: string,
): Promise<void> {
  await larkProcessedEvents().updateOne(
    { eventId },
    {
      $set: { status, ...(error ? { error: error.slice(0, 1000) } : {}), updatedAt: new Date() },
      $unset: { processingExpiresAt: '', ...(error ? {} : { error: '' }) },
    },
  )
}

// ─── Agent threads ───────────────────────────────────────────────────────────
export async function getOrCreateLarkAgentThread(data: {
  appId: string
  chatId: string
  threadId: string
  teamId: string
  agentUserId: string
  createdByLarkOpenId: string
  lastLarkEventId: string
}): Promise<{ thread: LarkAgentThread; isNew: boolean }> {
  const now = new Date()
  const sessionId = randomUUID()
  const thread = await larkAgentThreads().findOneAndUpdate(
    { appId: data.appId, chatId: data.chatId, threadId: data.threadId },
    {
      $setOnInsert: {
        sessionId,
        teamId: data.teamId,
        agentUserId: data.agentUserId,
        createdByLarkOpenId: data.createdByLarkOpenId,
        createdAt: now,
      },
      $set: { lastLarkEventId: data.lastLarkEventId, lastActiveAt: now },
    },
    { upsert: true, returnDocument: 'after' },
  )

  if (!thread) throw new Error('Failed to create Lark agent thread')

  return { thread, isNew: thread.sessionId === sessionId }
}

export async function getLarkAgentThreadBySessionId(
  sessionId: string,
): Promise<LarkAgentThread | null> {
  return await larkAgentThreads().findOne({ sessionId })
}

// Wipes all Lark bridge records for a team on disconnect so a later reinstall
// (or a different tenant binding) never reuses stale threads/mappings that still
// carry the old teamId/agentUserId.
export async function deleteLarkTeamBridgeState(teamId: string): Promise<void> {
  await Promise.all([
    larkChatMappings().deleteMany({ teamId }),
    larkUserMappings().deleteMany({ teamId }),
    larkAgentThreads().deleteMany({ teamId }),
  ])
}

export async function upsertLarkReplyFeedback(data: {
  appId: string
  chatId: string
  messageId: string
  larkOpenId: string
  sessionId?: string
  verdict: 'up' | 'down'
}): Promise<void> {
  const now = new Date()

  await larkReplyFeedback().updateOne(
    {
      appId: data.appId,
      chatId: data.chatId,
      messageId: data.messageId,
      larkOpenId: data.larkOpenId,
    },
    {
      $setOnInsert: { createdAt: now },
      $set: {
        ...(data.sessionId ? { sessionId: data.sessionId } : {}),
        verdict: data.verdict,
        updatedAt: now,
      },
    },
    { upsert: true },
  )
}
