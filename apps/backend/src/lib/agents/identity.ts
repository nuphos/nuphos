import { agentConversations } from '@/lib/agent/db'
import { canReply, conversationAccess } from '@/lib/agent/db/access'

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
 * execute as the teammate who actually sent that instruction. A teammate's
 * access is read again on every call, so unsharing the conversation also stops
 * the tokens their earlier turns were given.
 */
export async function verifyAgentForActor(
  actorUserId: string,
  conversationOwnerUserId: string,
  sessionId: string,
): Promise<AgentRef | null> {
  if (actorUserId === conversationOwnerUserId) return verifyAgent(actorUserId, sessionId)
  if (!sessionId) return null
  const conv = await agentConversations().findOne(
    { sessionId, userId: conversationOwnerUserId },
    {
      projection: {
        _id: 0,
        userId: 1,
        teamId: 1,
        generalAccess: 1,
        participantIds: 1,
        viewOnlyIds: 1,
        managerIds: 1,
      },
    },
  )

  if (!conv || !canReply(conversationAccess(conv, actorUserId))) return null

  return { userId: actorUserId, sessionId, conversationOwnerUserId }
}
