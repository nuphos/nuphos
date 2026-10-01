import { agentConversations } from '@/lib/agent/db'

export type AgentRef = {
  /** Principal whose permissions and credentials this execution may use. */
  userId: string
  sessionId: string
  /** Durable conversation/run owner when execution is delegated from a shared channel. */
  conversationOwnerUserId?: string
}

export function agentSubjectId(ref: AgentRef): string {
  return `${ref.userId}:${ref.sessionId}`
}

/**
 * Verify that the given user owns the given chat session, and return an
 * AgentRef if so. Returns null when the session is unknown or owned by a
 * different user (caller should 404/403).
 */
export async function verifyAgent(userId: string, sessionId: string): Promise<AgentRef | null> {
  if (!sessionId || sessionId.length === 0) return null
  const conv = await agentConversations().findOne({ sessionId, userId }, { projection: { _id: 1 } })

  if (!conv) return null

  return { userId, sessionId }
}

/**
 * Verify a durable conversation without replacing the execution principal.
 * Shared-channel messages live in one owner's transcript, but every turn must
 * execute as the teammate who actually sent that instruction.
 */
export async function verifyAgentForActor(
  actorUserId: string,
  conversationOwnerUserId: string,
  sessionId: string,
): Promise<AgentRef | null> {
  const owned = await verifyAgent(conversationOwnerUserId, sessionId)

  if (!owned) return null

  return {
    userId: actorUserId,
    sessionId,
    ...(actorUserId !== conversationOwnerUserId ? { conversationOwnerUserId } : {}),
  }
}
