import { getConversationMessages } from './conversations'
import { agentConversations, agentMessages } from './shared'

import type { AgentConversation, AgentMessage, AgentMessageFeedback } from './shared'

export type AdminFeedbackEntry = {
  sessionId: string
  messageId: string
  rating: 'up' | 'down'
  comment?: string
  voterUserId: string
  votedAt: Date
  ownerUserId: string
  teamId?: string
  conversationTitle?: string
  messageExcerpt: string
}

// Cross-conversation feed of rated assistant messages for the admin dashboard,
// newest votes first. Joined with the conversation for title/team; the message
// body is reduced to a text excerpt so the payload stays list-sized.
export async function getAdminFeedback(options?: {
  limit?: number
  cursor?: string
  rating?: 'up' | 'down'
}): Promise<{
  feedback: AdminFeedbackEntry[]
  counts: { up: number; down: number }
  nextCursor: string | null
  hasMore: boolean
}> {
  const limit = options?.limit ?? 50
  const match: Record<string, unknown> = {
    'feedback.rating': options?.rating ?? { $exists: true },
  }

  if (options?.cursor) match['feedback.updatedAt'] = { $lt: new Date(options.cursor) }

  const [docs, up, down] = await Promise.all([
    agentMessages()
      .aggregate<{
        sessionId: string
        messageId: string
        userId: string
        feedback: AgentMessageFeedback
        textParts?: { text?: string }[]
      }>([
        { $match: match },
        { $sort: { 'feedback.updatedAt': -1 } },
        { $limit: limit + 1 },
        {
          $project: {
            sessionId: 1,
            messageId: 1,
            userId: 1,
            feedback: 1,
            textParts: {
              $filter: { input: '$parts', as: 'part', cond: { $eq: ['$$part.type', 'text'] } },
            },
          },
        },
      ])
      .toArray(),
    agentMessages().countDocuments({ 'feedback.rating': 'up' }),
    agentMessages().countDocuments({ 'feedback.rating': 'down' }),
  ])

  const hasMore = docs.length > limit

  if (hasMore) docs.pop()

  const sessionIds = Array.from(new Set(docs.map((doc) => doc.sessionId)))
  const conversations = sessionIds.length
    ? await agentConversations()
        .find(
          { sessionId: { $in: sessionIds } },
          { projection: { sessionId: 1, title: 1, teamId: 1 } },
        )
        .toArray()
    : []
  const bySession = new Map(conversations.map((cv) => [cv.sessionId, cv]))

  const feedback = docs.map((doc): AdminFeedbackEntry => {
    const conversation = bySession.get(doc.sessionId)
    const excerpt = (doc.textParts ?? [])
      .map((part) => part.text ?? '')
      .join('\n')
      .trim()

    return {
      sessionId: doc.sessionId,
      messageId: doc.messageId,
      rating: doc.feedback.rating,
      ...(doc.feedback.comment ? { comment: doc.feedback.comment } : {}),
      voterUserId: doc.feedback.userId,
      votedAt: doc.feedback.updatedAt,
      ownerUserId: doc.userId,
      ...(conversation?.teamId ? { teamId: conversation.teamId } : {}),
      ...(conversation?.title ? { conversationTitle: conversation.title } : {}),
      messageExcerpt: excerpt.length > 300 ? `${excerpt.slice(0, 300)}…` : excerpt,
    }
  })

  const last = feedback[feedback.length - 1]

  return {
    feedback,
    counts: { up, down },
    nextCursor: hasMore && last ? last.votedAt.toISOString() : null,
    hasMore,
  }
}

export async function getAdminConversationWithMessages(
  sessionId: string,
): Promise<{ conversation: AgentConversation; messages: AgentMessage[] } | null> {
  const conversation = await agentConversations().findOne({ sessionId })

  if (!conversation) return null
  const messages = await getConversationMessages(sessionId, conversation.userId)

  return { conversation, messages }
}
