import { agentConversations } from './shared'

import type { AgentConversation } from './shared'

/**
 * Append teammates to a conversation's participant list and answer with the
 * conversation as it now stands. `$addToSet` makes this idempotent, so the send
 * path can call it without first reading the doc and two simultaneous invites
 * of the same person cannot duplicate them; returning the post-write document
 * means a caller rendering the result cannot miss a concurrent invite either.
 */
export async function addConversationParticipants(
  sessionId: string,
  userIds: readonly string[],
): Promise<AgentConversation | null> {
  const ids = Array.from(new Set(userIds.filter((id) => id.length > 0)))

  if (ids.length === 0) return null

  return await agentConversations().findOneAndUpdate(
    { sessionId },
    { $addToSet: { participantIds: { $each: ids } } },
    { returnDocument: 'after' },
  )
}

/**
 * The conversation's people, owner first. Callers already hold the doc, so this
 * is a pure shaping step: it de-duplicates the owner out of the participant
 * list (a legacy row could carry them) and keeps the order stable for the UI.
 */
export function conversationParticipantIds(conversation: {
  userId: string
  participantIds?: string[]
}): string[] {
  const seen = new Set<string>([conversation.userId])
  const ids = [conversation.userId]

  for (const id of conversation.participantIds ?? []) {
    if (seen.has(id)) continue
    seen.add(id)
    ids.push(id)
  }

  return ids
}
