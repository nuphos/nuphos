import { readableConversationScope } from './access'
import { agentConversations, withTeamScope } from './shared'

export type ConversationReadState = { activitySeq: number; readSeq: number; unread: boolean }

function seq(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0
}

/** The owner's marker is `readSeq`; each other member of a channel keeps their own. */
function readField(conversation: Readonly<Record<string, unknown>>, viewerId?: string) {
  return viewerId === undefined || conversation.userId === viewerId
    ? 'readSeq'
    : `memberReadSeq.${viewerId}`
}

export function conversationReadState(
  conversation: Readonly<Record<string, unknown>>,
  viewerId?: string,
): ConversationReadState {
  const activitySeq = seq(conversation.activitySeq)
  const field = readField(conversation, viewerId)
  const marker =
    field === 'readSeq'
      ? conversation.readSeq
      : (conversation.memberReadSeq as Record<string, unknown> | undefined)?.[viewerId ?? '']
  const readSeq = Math.min(seq(marker), activitySeq)

  return { activitySeq, readSeq, unread: activitySeq > readSeq }
}

export async function bumpConversationActivity(sessionId: string, userId: string): Promise<void> {
  await agentConversations().updateOne({ sessionId, userId }, { $inc: { activitySeq: 1 } })
}

/**
 * The owner's, or a channel member's own. The requested marker is clamped to the activity
 * the server has recorded and merged with `$max`, so a late or replayed
 * request can neither skip ahead of real activity nor move the marker back.
 */
export async function markConversationRead(
  sessionId: string,
  userId: string,
  teamId: string | undefined,
  requestedSeq: number,
): Promise<ConversationReadState | null> {
  const projection = { userId: 1, activitySeq: 1, readSeq: 1, memberReadSeq: 1 }
  const current =
    (await agentConversations().findOne(withTeamScope({ sessionId, userId }, teamId), {
      projection,
    })) ??
    (await agentConversations().findOne(
      readableConversationScope({ sessionId, kind: 'channel' }, userId, teamId),
      { projection },
    ))

  if (!current) return null
  const target = Math.min(seq(requestedSeq), seq(current.activitySeq))
  const updated = await agentConversations().findOneAndUpdate(
    { sessionId, userId: current.userId },
    { $max: { [readField(current, userId)]: target } },
    { returnDocument: 'after', projection },
  )

  return conversationReadState(updated ?? current, userId)
}

/**
 * The app badge: the owner's unread conversations they watch, archived ones
 * excluded. Read markers are the owner's alone, so a teammate's conversation
 * a user watches alerts them but never counts here.
 */
export async function countUnreadConversations(userId: string, teamId?: string): Promise<number> {
  return await agentConversations().countDocuments({
    userId,
    ...(teamId ? { teamId } : {}),
    archivedAt: { $exists: false },
    watcherIds: userId,
    $expr: { $gt: [{ $ifNull: ['$activitySeq', 0] }, { $ifNull: ['$readSeq', 0] }] },
  })
}
