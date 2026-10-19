import { agentConversations } from './shared'

import type { ExplicitUserDecision } from '@/lib/agent/tools-skilled/types'

/**
 * The question a session is waiting on the owner to answer: the latest
 * request_user_decision card, kept on the conversation so an Inbox can list it
 * across sessions. The next human message in the session is the answer.
 */
export type PendingDecision = ExplicitUserDecision & { toolCallId: string; askedAt: Date }

/** A newer question replaces the one before it: a session waits on one thing. */
export async function setPendingDecision(
  sessionId: string,
  userId: string,
  decision: PendingDecision,
): Promise<void> {
  await agentConversations().updateOne(
    { sessionId, userId },
    { $set: { pendingDecision: decision } },
  )
}

export async function clearPendingDecision(sessionId: string, userId: string): Promise<void> {
  await agentConversations().updateOne(
    { sessionId, userId, pendingDecision: { $exists: true } },
    { $unset: { pendingDecision: '' } },
  )
}
