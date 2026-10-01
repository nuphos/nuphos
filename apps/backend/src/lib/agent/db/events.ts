import { db } from '@/lib/db'
import { logError } from '@/lib/observability'
import { replicaId } from '@/lib/redis'

import { agentConversations, agentEvents, agentMessages } from './shared'

import type { AgentEventDoc } from './shared'

export async function setupAgentIndexes(): Promise<void> {
  const c = agentConversations()
  const m = agentMessages()

  try {
    await c.createIndex({ userId: 1, lastActiveAt: -1 }, { background: true })
    // Admin activation metrics find each user's first-ever conversation.
    await c.createIndex({ userId: 1, createdAt: 1 }, { background: true })
    await c.createIndex({ userId: 1, teamId: 1, lastActiveAt: -1 }, { background: true })
    // The compact Chats sidebar is stable by creation time, so continuing an
    // older conversation cannot move it above a newer one.
    await c.createIndex(
      { teamId: 1, userId: 1, 'metadata.trigger.id': 1, createdAt: -1 },
      { background: true },
    )
    // The sidebar's Shared section: same question as the Chats index above,
    // asked of the participant list instead of the owner.
    await c.createIndex(
      { teamId: 1, participantIds: 1, 'metadata.trigger.id': 1, createdAt: -1 },
      { background: true },
    )
    await c.createIndex({ teamId: 1, lastActiveAt: -1 }, { background: true })
    await c.createIndex(
      { teamId: 1, userId: 1, archivedAt: -1 },
      { background: true, partialFilterExpression: { archivedAt: { $exists: true } } },
    )
    await c.createIndex({ sessionId: 1 }, { unique: true, background: true })
    await c.createIndex({ teamId: 1, 'claudeCodePreview.runtimeUrl': 1 }, { background: true })
    await c.createIndex({ teamId: 1, previousRuntimeUrls: 1 }, { background: true })
    await db().collection('agent_runtime_deletions').createIndex({ provider: 1, completedAt: 1 })
    await db().collection('agent_runtime_deletions').createIndex({ teamId: 1, 'placements.url': 1 })
    // Every conversation listing now discriminates on the trigger stamp: a
    // Trigger's Runs list matches it, Chats excludes it. Both are the same
    // team-scoped, lastActiveAt-ordered page, so one index serves both — and
    // without it the exclusion turns every Chats page into a collection scan.
    await c.createIndex(
      { teamId: 1, 'metadata.trigger.id': 1, lastActiveAt: -1 },
      { background: true },
    )
    // Conversations that went quiet in a time window, whoever owns them: the
    // stuck-turn probe's only query. Every other index here starts with userId
    // or teamId, so none of them can serve an unscoped range on lastActiveAt.
    await c.createIndex({ lastActiveAt: 1 }, { background: true })
    await dropLegacyConversationTtlIndex()
    await m.createIndex({ userId: 1, sessionId: 1, index: 1 }, { unique: true, background: true })
    await m.createIndex(
      { userId: 1, sessionId: 1, messageId: 1 },
      { unique: true, background: true },
    )
    await m.createIndex({ userId: 1, updatedAt: -1 }, { background: true })
    // Tail of a conversation without knowing whose turn wrote it (stuck-turn probe).
    await m.createIndex({ sessionId: 1, index: -1 }, { background: true })
    // Admin feedback feed: rated messages only, newest votes first.
    await m.createIndex(
      { 'feedback.rating': 1, 'feedback.updatedAt': -1 },
      { background: true, partialFilterExpression: { 'feedback.rating': { $exists: true } } },
    )
    // Per-conversation timeline + cross-conversation per-event-type analytics.
    await agentEvents().createIndex({ conversationId: 1, ts: 1 }, { background: true })
    await agentEvents().createIndex({ event: 1, ts: -1 }, { background: true })
  } catch (err) {
    logError('agent.db.indexes_create_failed', err)
  }
}

// Fire-and-forget: event recording must never block or fail the operation
// being recorded.
export function recordAgentEvent(fields: {
  conversationId: string
  event: string
  userId?: string
  data?: Record<string, unknown>
}): void {
  agentEvents()
    .insertOne({
      conversationId: fields.conversationId,
      event: fields.event,
      ts: new Date(),
      replicaId,
      ...(fields.userId ? { userId: fields.userId } : {}),
      ...(fields.data && Object.keys(fields.data).length ? { data: fields.data } : {}),
    })
    .catch((err: unknown) => {
      logError('agent.events.insert_failed', err, {
        conversation_id: fields.conversationId,
        event: fields.event,
      })
    })
}

export const EMPTY_CONTENT_FILTERED_REPLY_EVENT = 'agent.chat.empty_content_filtered_reply'

// Args for the agentEvents row a content-filtered empty reply records, so it
// reaches the Admin session timeline (which reads agentEvents, not the
// journal). Split from the recordAgentEvent call so the name + data shape are
// unit-testable without a live Mongo.
export function buildEmptyContentFilteredReplyEvent(args: {
  conversationId: string
  userId?: string
  finishReason: string
  outputEmpty: boolean
  modelId: string
}): {
  conversationId: string
  event: string
  userId?: string
  data: Record<string, unknown>
} {
  return {
    conversationId: args.conversationId,
    event: EMPTY_CONTENT_FILTERED_REPLY_EVENT,
    ...(args.userId ? { userId: args.userId } : {}),
    data: {
      finishReason: args.finishReason,
      outputEmpty: args.outputEmpty,
      modelId: args.modelId,
    },
  }
}

export async function listAgentEvents(
  conversationId: string,
  options?: { prefix?: string; limit?: number },
): Promise<AgentEventDoc[]> {
  const query: Record<string, unknown> = { conversationId }

  if (options?.prefix) {
    query.event = { $regex: `^${options.prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}` }
  }
  // Take the newest window when the cap bites, then flip back to
  // chronological order for display.
  const docs = await agentEvents()
    .find(query)
    .sort({ ts: -1 })
    .limit(options?.limit ?? 500)
    .toArray()

  return docs.reverse()
}

async function dropLegacyConversationTtlIndex(): Promise<void> {
  const c = agentConversations()

  try {
    const indexes = await c.listIndexes().toArray()
    const ttlIndex = indexes.find(
      (idx) =>
        idx.name === 'createdAt_1' &&
        typeof (idx as { expireAfterSeconds?: unknown }).expireAfterSeconds === 'number',
    )

    if (ttlIndex?.name) await c.dropIndex(ttlIndex.name)
  } catch (err) {
    logError('agent.db.legacy_ttl_index_inspect_failed', err)
  }
}
