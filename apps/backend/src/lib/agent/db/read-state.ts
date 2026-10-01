import { agentConversations, withTeamScope } from './shared'

export type ConversationReadState = { activitySeq: number; readSeq: number; unread: boolean }

function seq(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0
}

export function conversationReadState(
  conversation: Readonly<Record<string, unknown>>,
): ConversationReadState {
  const activitySeq = seq(conversation.activitySeq)
  const readSeq = Math.min(seq(conversation.readSeq), activitySeq)

  return { activitySeq, readSeq, unread: activitySeq > readSeq }
}

export async function bumpConversationActivity(sessionId: string, userId: string): Promise<void> {
  await agentConversations().updateOne({ sessionId, userId }, { $inc: { activitySeq: 1 } })
}

/**
 * Owner-only, like archiving. The requested marker is clamped to the activity
 * the server has recorded and merged with `$max`, so a late or replayed
 * request can neither skip ahead of real activity nor move the marker back.
 */
export async function markConversationRead(
  sessionId: string,
  userId: string,
  teamId: string | undefined,
  requestedSeq: number,
): Promise<ConversationReadState | null> {
  const scope = withTeamScope({ sessionId, userId }, teamId)
  const current = await agentConversations().findOne(scope, {
    projection: { activitySeq: 1, readSeq: 1 },
  })

  if (!current) return null
  const target = Math.min(seq(requestedSeq), seq(current.activitySeq))
  const updated = await agentConversations().findOneAndUpdate(
    scope,
    { $max: { readSeq: target } },
    { returnDocument: 'after', projection: { activitySeq: 1, readSeq: 1 } },
  )

  return conversationReadState(updated ?? current)
}

/** The owner's unread Chats: archived conversations and trigger runs don't count. */
export async function countUnreadConversations(userId: string, teamId?: string): Promise<number> {
  return await agentConversations().countDocuments({
    userId,
    ...(teamId ? { teamId } : {}),
    archivedAt: { $exists: false },
    'metadata.trigger.id': { $exists: false },
    $expr: { $gt: [{ $ifNull: ['$activitySeq', 0] }, { $ifNull: ['$readSeq', 0] }] },
  })
}
