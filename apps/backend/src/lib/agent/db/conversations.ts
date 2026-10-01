// From the registry-free stamp module, NOT runtime.ts — runtime pulls the
// provider registry, whose native adapter reaches identity.ts and back into
// this file (import cycle).
import { resolveForNewSession } from '@/lib/agent/memory-slots/session-stamp'

import { fallbackTitle } from '../title-fallback'

import { recordAgentEvent } from './events'
import {
  agentConversations,
  agentMessages,
  readableConversationScope,
  withTeamScope,
} from './shared'

import type { ConversationTriggerRun } from '../conversation-trigger-run'
import type {
  AgentClientMeta,
  AgentConversation,
  AgentCredentialAccess,
  ConversationPreviewAttachment,
  ConversationPreviewContext,
  AgentMessage,
} from './shared'

// Sticky content-filter model-fallback helpers live in a sibling file (this
// one is at the max-lines limit); re-exported so existing import paths hold.
export {
  buildModelFallbackMark,
  getConversationModelFallbackModelId,
  markConversationModelFallbackActive,
  pickModelFallbackModelId,
} from './conversations-model-fallback'

export async function upsertConversationShell(data: {
  sessionId: string
  userId: string
  teamId?: string
  title: string
  firstMessage: string
  locale?: string
  provider?: string
  source?: string
  /**
   * The trigger that fired this conversation, when one did. Write-once by
   * construction — it lives in `metadata`, which only $setOnInsert touches —
   * because every later turn (the agent's own, or a teammate continuing the
   * run from the Trigger page) arrives without trigger context and would
   * otherwise erase the only link back to the Trigger.
   */
  trigger?: ConversationTriggerRun
  client?: AgentClientMeta
  credentialAccess?: AgentCredentialAccess
  agentRuntime?: NonNullable<AgentConversation['agentRuntime']>
  runtimeId?: string
  runtimeLabel?: string
}): Promise<{ isNew: boolean }> {
  const now = new Date()
  // MongoDB rejects the same field appearing in both $setOnInsert and $set
  // ("Updating the path 'title' would create a conflict at 'title'", error
  // code 40). When data.title is truthy, $set.title fires, so don't also
  // include title in $setOnInsert. When data.title is empty (preserveTitle
  // path), $set doesn't touch title, so $setOnInsert can default it.
  const setOnInsert: Record<string, unknown> = {
    sessionId: data.sessionId,
    userId: data.userId,
    // Immutable memory-backend stamp (SPI decision 4 / A3): lives ONLY in
    // $setOnInsert so later upserts can never re-route a running session.
    memoryProvider: resolveForNewSession({ teamId: data.teamId ?? null }).providerId,
    firstMessage: data.firstMessage.slice(0, 500),
    messageCount: 0,
    createdAt: now,
    ...(data.agentRuntime ? { agentRuntime: data.agentRuntime } : {}),
    ...(data.runtimeId ? { runtimeId: data.runtimeId, runtimeLabel: data.runtimeLabel } : {}),
    metadata: {
      locale: data.locale,
      provider: data.provider,
      ...(data.source ? { source: data.source } : {}),
      ...(data.trigger ? { trigger: data.trigger } : {}),
      ...(data.client ? { client: data.client } : {}),
    },
  }

  if (!data.title) {
    setOnInsert.title = fallbackTitle(data.firstMessage)
  }
  const result = await agentConversations().updateOne(
    withTeamScope({ sessionId: data.sessionId, userId: data.userId }, data.teamId),
    {
      $setOnInsert: setOnInsert,
      $set: {
        lastActiveAt: now,
        ...(data.teamId ? { teamId: data.teamId } : {}),
        ...(data.title ? { title: data.title } : {}),
        ...(data.credentialAccess ? { credentialAccess: data.credentialAccess } : {}),
      },
    },
    { upsert: true },
  )

  return { isNew: result.upsertedCount > 0 }
}

// Per-turn memory resolution read (Phase 2 chat-path swap): the stamp is a
// property of the conversation itself, independent of the viewing user, so
// this deliberately reads by sessionId alone (shared-conversation turns must
// resolve the owner's stamp, not re-derive one). Undefined = unstamped legacy
// doc OR the doc has not landed yet (brand-new conversation racing its own
// accepted-turn upsert) — both resolve to the global default downstream.
export async function getConversationMemoryProvider(
  sessionId: string,
): Promise<string | undefined> {
  const doc = await agentConversations().findOne(
    { sessionId },
    { projection: { _id: 0, memoryProvider: 1 } },
  )

  return doc?.memoryProvider
}

// Lazy write-once stamp for pre-stamp legacy conversations: the filter is the
// once-guard — a doc that already carries ANY stamp never matches, so a racing
// upsert/stamp pair can never re-route a session (SPI decision 4). Missing doc
// (accepted-turn upsert not landed yet) matches nothing; that upsert's
// $setOnInsert stamps the same resolved default itself.
export async function stampConversationMemoryProvider(
  sessionId: string,
  providerId: string,
): Promise<void> {
  await agentConversations().updateOne(
    { sessionId, memoryProvider: { $exists: false } },
    { $set: { memoryProvider: providerId } },
  )
}

export async function getConversation(
  sessionId: string,
  userId: string,
  teamId?: string,
): Promise<AgentConversation | null> {
  return await agentConversations().findOne(withTeamScope({ sessionId, userId }, teamId))
}

export async function getConversationBySessionId(
  sessionId: string,
): Promise<AgentConversation | null> {
  return await agentConversations().findOne({ sessionId })
}

export async function setConversationPreviewContext(
  sessionId: string,
  teamId: string,
  context: ConversationPreviewContext,
): Promise<void> {
  await agentConversations().updateOne(
    { sessionId, teamId },
    { $set: { claudeCodePreviewContext: context } },
  )
}

export async function updateConversationCredentialAccess(
  sessionId: string,
  userId: string,
  teamId: string | undefined,
  credentialAccess: AgentCredentialAccess,
): Promise<AgentConversation | null> {
  const result = await agentConversations().findOneAndUpdate(
    withTeamScope({ sessionId, userId }, teamId),
    {
      $set: {
        credentialAccess,
        lastActiveAt: new Date(),
        ...(teamId ? { teamId } : {}),
      },
    },
    { returnDocument: 'after' },
  )

  if (result) {
    recordAgentEvent({
      conversationId: sessionId,
      event: 'credentials.updated',
      userId,
      data: { ...credentialAccess },
    })
  }

  return result
}

export async function getConversationMessages(
  sessionId: string,
  userId: string,
  options?: { tail?: number; beforeIndex?: number },
): Promise<AgentMessage[]> {
  const filter: Record<string, unknown> = { sessionId, userId }

  if (options?.beforeIndex !== undefined) {
    filter.index = { $lt: options.beforeIndex }
  }
  if (options?.tail !== undefined) {
    // Last N of the (filtered) range: sort desc, limit, then restore order.
    const docs = await agentMessages()
      .find(filter)
      .sort({ index: -1 })
      .limit(options.tail)
      .toArray()

    return docs.reverse()
  }

  return await agentMessages().find(filter).sort({ index: 1 }).toArray()
}

/** Set or clear (rating null) the viewer's feedback on a message. Message docs
 *  are keyed by the conversation owner's userId, not the voter's. */
export async function setMessageFeedback(args: {
  sessionId: string
  ownerUserId: string
  messageId: string
  rating: 'up' | 'down' | null
  comment?: string
  voterUserId: string
}): Promise<boolean> {
  const filter = {
    sessionId: args.sessionId,
    userId: args.ownerUserId,
    messageId: args.messageId,
  }
  // Field-level $set so the vote click and the later comment submit compose:
  // a rating-only write must not wipe a comment that already landed.
  const result = await agentMessages().updateOne(
    filter,
    args.rating === null
      ? { $unset: { feedback: '' } }
      : {
          $set: {
            'feedback.rating': args.rating,
            'feedback.userId': args.voterUserId,
            'feedback.updatedAt': new Date(),
            ...(args.comment ? { 'feedback.comment': args.comment } : {}),
          },
        },
  )

  return result.matchedCount > 0
}

/** Conversation readable by the viewer (own, or any conversation of a verified team). */
export async function getReadableConversation(
  sessionId: string,
  viewerUserId: string,
  teamId?: string,
): Promise<AgentConversation | null> {
  return await agentConversations().findOne(
    readableConversationScope({ sessionId }, viewerUserId, teamId),
  )
}

export async function getConversationWithMessages(
  sessionId: string,
  viewerUserId: string,
  teamId?: string,
  options?: { tail?: number },
): Promise<{ conversation: AgentConversation; messages: AgentMessage[] } | null> {
  const conversation = await agentConversations().findOne(
    readableConversationScope({ sessionId }, viewerUserId, teamId),
  )

  if (!conversation) return null
  const messages = await getConversationMessages(sessionId, conversation.userId, {
    tail: options?.tail,
  })

  return { conversation, messages }
}
