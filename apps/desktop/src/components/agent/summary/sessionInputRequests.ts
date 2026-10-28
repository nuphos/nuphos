import type { AgentConversation } from '../../../api/agent-types.ts'

export function inputRequestKey(conversation: AgentConversation): string {
  return `${conversation.sessionId}:${conversation.pendingDecision?.toolCallId ?? ''}`
}

/** This session and its readable descendants. */
export function relatedSessionIds(
  sessionId: string,
  conversations: readonly AgentConversation[],
): Set<string> {
  const related = new Set([sessionId])
  const byId = new Map(conversations.map((conversation) => [conversation.sessionId, conversation]))
  let changed = true

  while (changed) {
    changed = false
    for (const conversation of byId.values()) {
      if (
        conversation.parentSessionId &&
        related.has(conversation.parentSessionId) &&
        !related.has(conversation.sessionId)
      ) {
        related.add(conversation.sessionId)
        changed = true
      }
    }
  }

  return related
}

/** Explicit requests from this session and its readable descendants, oldest first. */
export function sessionInputRequests(
  sessionId: string,
  conversations: readonly AgentConversation[],
): AgentConversation[] {
  const related = relatedSessionIds(sessionId, conversations)

  return [
    ...new Map(
      conversations.map((conversation) => [conversation.sessionId, conversation]),
    ).values(),
  ]
    .filter((conversation) => related.has(conversation.sessionId) && conversation.pendingDecision)
    .sort(
      (a, b) =>
        (a.pendingDecision?.askedAt ?? '').localeCompare(b.pendingDecision?.askedAt ?? '') ||
        a.sessionId.localeCompare(b.sessionId),
    )
}
