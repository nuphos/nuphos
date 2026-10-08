import { fallbackTitle } from '../title-fallback'

import { readableByFilter } from './access'
import { upsertConversationShell } from './conversations'
import { agentConversations, agentMessages, escapeRegExp, withTeamScope } from './shared'
import { preserveRuntimeToolResults } from './transcript-runtime-tool-results'
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
        { projection: { _id: 1, index: 1, messageId: 1, role: 1, parts: 1, metadata: 1 } },
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

      return stale ? [message._id] : []
    })

    if (staleDocumentIds.length > 0) {
      await agentMessages().deleteMany({ _id: { $in: staleDocumentIds } })
    }
  }

  if (data.messages.length > 0) {
    await agentMessages().bulkWrite(
      data.messages.map((message, index) => ({
        updateOne: {
          filter: {
            sessionId: data.sessionId,
            userId: data.userId,
            index,
          },
          update: {
            $set: {
              ...(attribution.get(message.id) || message.metadata
                ? { metadata: attribution.get(message.id)?.metadata ?? message.metadata }
                : {}),
              messageId: message.id,
              role: attribution.get(message.id)?.role ?? message.role,
              parts: preserveRuntimeToolResults(
                attribution.get(message.id)?.role === 'user'
                  ? attribution.get(message.id)!.parts
                  : message.parts,
                runtimeToolParts,
              ),
              // Only ever set, never unset: a re-sync that rebuilt history
              // without the bridge context must not erase where the message
              // originally came from.
              ...(message.origin ? { origin: message.origin } : {}),
              ...(message.turnOrigin === 'autonomous' ? { turnOrigin: 'autonomous' } : {}),
              ...(message.turnKind === 'plan-approval' ? { turnKind: 'plan-approval' } : {}),
              updatedAt: now,
            },
            $setOnInsert: {
              sessionId: data.sessionId,
              userId: data.userId,
              index,
              createdAt: now,
            },
          },
          upsert: true,
        },
      })),
      { ordered: false },
    )
  }

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

export type ConversationsScope = 'mine' | 'team' | 'shared'
export type ConversationsArchivedFilter = 'exclude' | 'only'
export type ConversationsSort = 'activity' | 'created' | 'archived'

const CONVERSATION_SORT_FIELDS = {
  activity: 'lastActiveAt',
  created: 'createdAt',
  archived: 'archivedAt',
} as const satisfies Record<ConversationsSort, keyof AgentConversation>

/**
 * teamId is required, and deliberately so: every listing is a question about
 * one team. It used to be optional, and a caller that failed to supply one got
 * the viewer's chats from every team they belong to — a plausible-looking list
 * that silently crossed the team boundary the caller thought it was inside.
 * There is no "all my teams" feed; ask per team.
 */
export async function getConversations(
  viewerUserId: string,
  options: {
    teamId: string
    limit?: number
    cursor?: string
    scope?: ConversationsScope
    /** Restrict to one team member's conversations, for the Chats reader's
     *  member filter. Only meaningful in team scope, where every member's
     *  conversations are already visible. */
    ownerId?: string
    search?: string
    /** Sort newest-first by recent activity (default), creation time, or
     *  archive time — the last lists archived conversations only. */
    sort?: ConversationsSort
    // Omitted = archived and unarchived both list (existing consumers keep
    // seeing everything); 'exclude' powers the sidebar, 'only' the archive.
    archived?: ConversationsArchivedFilter
    /**
     * A trigger's run history. Omitted means the other side of the same coin:
     * Chats, which excludes every trigger-stamped conversation — a run belongs
     * to its Trigger, not to the chat list. An empty array is a Watch group
     * with no partitions yet, and matches nothing rather than degrading into
     * the unfiltered list.
     *
     * Conversations from before the stamp existed carry no `metadata.trigger`,
     * so they stay in Chats. There is nothing to attribute them to, and
     * hiding them would strand them in a Runs list they can never reach.
     */
    triggerIds?: string[]
  },
): Promise<{
  conversations: AgentConversation[]
  nextCursor: string | null
  hasMore: boolean
}> {
  if (!options.teamId) throw new Error('getConversations requires a teamId')
  const limit = options.limit ?? 20
  // Scoping rules:
  //   'mine'   → only the viewer's chats within that team (default — what
  //              "Recent" intuitively means to the viewer)
  //   'team'   → every team member's chats (old default; opt-in now)
  //   'shared' → chats the viewer joined but does not own. The complement of
  //              'mine' within what the sidebar shows, so the two lists
  //              together never repeat a conversation.
  const scope: ConversationsScope = options.scope ?? 'mine'
  const sortField = CONVERSATION_SORT_FIELDS[options.sort ?? 'activity']
  const query: Record<string, unknown> = {
    teamId: options.teamId,
    // Kept apart from the search $or below, which would otherwise replace it.
    $and: [readableByFilter(viewerUserId)],
  }

  if (scope === 'mine') query.userId = viewerUserId
  if (scope === 'shared') {
    query.participantIds = viewerUserId
    query.userId = { $ne: viewerUserId }
  }

  // Narrowing team scope to one member reads the same as 'mine' with someone
  // else's id, limited like every scope to what the viewer may read.
  if (scope === 'team' && options.ownerId) query.userId = options.ownerId
  query['metadata.trigger.id'] = options.triggerIds
    ? { $in: options.triggerIds }
    : { $exists: false }
  if (options.archived === 'only' || options.sort === 'archived') {
    query.archivedAt = { $exists: true }
  } else if (options.archived === 'exclude') {
    query.archivedAt = { $exists: false }
  }
  if (options.cursor) {
    query[sortField] = {
      ...(query[sortField] as Record<string, unknown> | undefined),
      $lt: new Date(options.cursor),
    }
  }
  const search = options.search?.trim()

  if (search) {
    // Substring match, not full-text: history search targets short titles /
    // first messages, where regex is predictable. The user/team index prefix
    // keeps the scan bounded to the viewer's own documents.
    const pattern = new RegExp(escapeRegExp(search), 'i')

    query.$or = [{ title: pattern }, { firstMessage: pattern }]
  }

  const conversations = await agentConversations()
    .find(query)
    .sort({ [sortField]: -1 })
    .limit(limit + 1)
    .toArray()

  const hasMore = conversations.length > limit

  if (hasMore) conversations.pop()

  const last = conversations[conversations.length - 1]
  const nextCursor = hasMore ? (last?.[sortField]?.toISOString() ?? null) : null

  return { conversations, nextCursor, hasMore }
}
