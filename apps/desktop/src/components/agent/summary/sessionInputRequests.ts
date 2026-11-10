import { openInputRequests } from '../../../lib/agentInputRequests.ts'

import type { AgentConversation, AgentInputRequest } from '../../../api/agent-types.ts'

/** One open question and the conversation that asked it. */
export type SessionInputRequest = AgentConversation & { inputRequest: AgentInputRequest }

export function inputRequestKey(request: SessionInputRequest): string {
  return `${request.sessionId}:${request.inputRequest.id}`
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
): SessionInputRequest[] {
  const related = relatedSessionIds(sessionId, conversations)

  return openRequestsOf(conversations.filter((c) => related.has(c.sessionId)))
}

/** The open requests of these conversations, each once, oldest first. */
function openRequestsOf(conversations: readonly AgentConversation[]): SessionInputRequest[] {
  return [
    ...new Map(
      conversations.map((conversation) => [conversation.sessionId, conversation]),
    ).values(),
  ]
    .flatMap((conversation) =>
      openInputRequests(conversation).map((inputRequest) => ({ ...conversation, inputRequest })),
    )
    .sort(
      (a, b) =>
        a.inputRequest.askedAt.localeCompare(b.inputRequest.askedAt) ||
        a.sessionId.localeCompare(b.sessionId) ||
        a.inputRequest.id.localeCompare(b.inputRequest.id),
    )
}

/**
 * The open questions of one Bot and the agents under it, drawn from the pending
 * listing alone: a cached row may still hold a question answered long ago. Other
 * rows only say who sits under whom. Questions answered on this device are left out.
 */
export function botQuestions(
  botId: string,
  pending: readonly AgentConversation[],
  known: readonly AgentConversation[],
  answered: ReadonlyMap<string, number>,
): SessionInputRequest[] {
  const related = relatedSessionIds(botId, [...known, ...pending])

  return openRequestsOf(pending.filter((c) => related.has(c.sessionId))).filter(
    (request) => !answered.has(request.inputRequest.id),
  )
}
