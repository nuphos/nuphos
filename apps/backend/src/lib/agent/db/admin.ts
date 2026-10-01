import { ObjectId } from 'mongodb'

import { agentConversations, agentMessages, escapeRegExp } from './shared'

import type { AgentConversation, AgentMessage } from './shared'
import type { Collection } from 'mongodb'

export type StatWindows = {
  last24h: number
  last7d: number
  last30d: number
}

export async function getAdminConversationStats(): Promise<{
  conversationCount: number
  messageCount: number
  userCount: number
  lastActiveAt: Date | null
  conversationWindows: StatWindows
  messageWindows: StatWindows
}> {
  // Window counts filter on _id's embedded creation timestamp — index-backed
  // via the default _id index, so no dedicated createdAt index is needed.
  const now = Date.now()
  const DAY_MS = 86_400_000
  const idSince = (windowMs: number) => ObjectId.createFromTime(Math.floor((now - windowMs) / 1000))
  const windowCounts = async (
    collection: () => Collection<AgentConversation> | Collection<AgentMessage>,
  ): Promise<StatWindows> => {
    const [last24h, last7d, last30d] = await Promise.all([
      collection().countDocuments({ _id: { $gte: idSince(DAY_MS) } }),
      collection().countDocuments({ _id: { $gte: idSince(7 * DAY_MS) } }),
      collection().countDocuments({ _id: { $gte: idSince(30 * DAY_MS) } }),
    ])

    return { last24h, last7d, last30d }
  }
  const [conversationCount, messageCount, userIds, latest, conversationWindows, messageWindows] =
    await Promise.all([
      agentConversations().countDocuments(),
      agentMessages().countDocuments(),
      agentConversations().distinct('userId'),
      agentConversations()
        .find({}, { projection: { lastActiveAt: 1 } })
        .sort({ lastActiveAt: -1 })
        .limit(1)
        .toArray(),
      windowCounts(agentConversations),
      windowCounts(agentMessages),
    ])

  return {
    conversationCount,
    messageCount,
    userCount: userIds.length,
    lastActiveAt: latest[0]?.lastActiveAt ?? null,
    conversationWindows,
    messageWindows,
  }
}

export type AdminFilterOp = 'is' | 'not'

export async function getAdminConversations(options?: {
  limit?: number
  cursor?: string
  q?: string
  userId?: string
  userOp?: AdminFilterOp
  teamId?: string
  teamOp?: AdminFilterOp
  sessionId?: string
}): Promise<{
  conversations: AgentConversation[]
  nextCursor: string | null
  hasMore: boolean
}> {
  const limit = options?.limit ?? 50
  const query: Record<string, unknown> = {}
  const clauses: Record<string, unknown>[] = []

  if (options?.cursor) clauses.push({ lastActiveAt: { $lt: new Date(options.cursor) } })
  if (options?.userId) {
    clauses.push({ userId: options.userOp === 'not' ? { $ne: options.userId } : options.userId })
  }
  if (options?.teamId) {
    // $ne also matches docs with no teamId at all — "not this team" should
    // include personal (team-less) conversations.
    clauses.push({ teamId: options.teamOp === 'not' ? { $ne: options.teamId } : options.teamId })
  }
  if (options?.sessionId) clauses.push({ sessionId: options.sessionId })
  if (options?.q) {
    const re = new RegExp(escapeRegExp(options.q), 'i')

    clauses.push({
      $or: [{ title: re }, { firstMessage: re }, { sessionId: re }, { userId: re }],
    })
  }
  if (clauses.length === 1) Object.assign(query, clauses[0])
  if (clauses.length > 1) query.$and = clauses

  // Project down to what the admin list renders — full docs carry fat fields
  // (compactionSummary, tokenUsage, credentialAccess) that triple the payload.
  const conversations = await agentConversations()
    .find(query, {
      projection: {
        sessionId: 1,
        userId: 1,
        teamId: 1,
        title: 1,
        firstMessage: 1,
        messageCount: 1,
        createdAt: 1,
        lastActiveAt: 1,
      },
    })
    .sort({ lastActiveAt: -1 })
    .limit(limit + 1)
    .toArray()

  const hasMore = conversations.length > limit

  if (hasMore) conversations.pop()

  const last = conversations[conversations.length - 1]

  return {
    conversations,
    nextCursor: hasMore && last ? last.lastActiveAt.toISOString() : null,
    hasMore,
  }
}

// Newest conversation activity per user / team — used by the admin directory
// lists to sort by "last active". Tiny collection; a full group is fine.
export async function getLastActiveByUser(): Promise<Map<string, Date>> {
  const rows = await agentConversations()
    .aggregate<{ _id: string; lastActiveAt: Date }>([
      { $group: { _id: '$userId', lastActiveAt: { $max: '$lastActiveAt' } } },
    ])
    .toArray()

  return new Map(rows.filter((r) => r._id).map((r) => [r._id, r.lastActiveAt]))
}

export async function getLastActiveByTeam(): Promise<Map<string, Date>> {
  const rows = await agentConversations()
    .aggregate<{ _id: string; lastActiveAt: Date }>([
      { $match: { teamId: { $exists: true, $ne: null } } },
      { $group: { _id: '$teamId', lastActiveAt: { $max: '$lastActiveAt' } } },
    ])
    .toArray()

  return new Map(rows.filter((r) => r._id).map((r) => [r._id, r.lastActiveAt]))
}
