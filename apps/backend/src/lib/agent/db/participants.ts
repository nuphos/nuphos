import { agentConversations } from './shared'

import type { AgentConversation, ConversationTimelineEvent } from './shared'

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

// Bounded so the conversation doc, which every detail read returns, cannot grow
// without limit in a session people keep coming and going from.
const MAX_TIMELINE_EVENTS = 200

export function pushTimelineEvent(event: ConversationTimelineEvent) {
  return { timelineEvents: { $each: [event], $slice: -MAX_TIMELINE_EVENTS } }
}

/**
 * Bring teammates in on someone's behalf and record who did it. Each id is a
 * separate conditional write, so only a person who was actually absent gets an
 * "invited" event — re-inviting a participant, the owner, or racing another
 * invite of the same person adds nothing twice.
 */
export async function inviteConversationParticipants(
  sessionId: string,
  actorId: string,
  userIds: readonly string[],
): Promise<AgentConversation | null> {
  for (const id of new Set(userIds)) {
    await agentConversations().updateOne(
      { sessionId, userId: { $ne: id }, participantIds: { $ne: id } },
      {
        $push: {
          participantIds: id,
          ...pushTimelineEvent({
            kind: 'participant_invited',
            at: new Date(),
            actorId,
            targetId: id,
          }),
        },
      },
    )
  }

  return await agentConversations().findOne({ sessionId })
}

/** Take someone out of the conversation; a no-op when they were not in it. */
export async function removeConversationParticipant(
  sessionId: string,
  actorId: string,
  userId: string,
): Promise<AgentConversation | null> {
  await agentConversations().updateOne(
    { sessionId, participantIds: userId },
    {
      $pull: { participantIds: userId },
      $push: pushTimelineEvent({
        kind: 'participant_removed',
        at: new Date(),
        actorId,
        targetId: userId,
      }),
    },
  )

  return await agentConversations().findOne({ sessionId })
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
