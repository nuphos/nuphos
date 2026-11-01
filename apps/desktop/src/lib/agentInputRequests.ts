import { t } from '../i18n/index.ts'

import type { AgentConversation, AgentInputRequest } from '../api/agent-types.ts'

/**
 * A conversation's open questions, oldest first. A backend from before request
 * lists only sends `pendingDecision`, which reads as a list of one.
 */
export function openInputRequests(
  conversation: Pick<AgentConversation, 'inputRequests' | 'pendingDecision'>,
): AgentInputRequest[] {
  if (conversation.inputRequests)
    return conversation.inputRequests
      .filter((request) => request.status === 'open')
      .sort((a, b) => a.askedAt.localeCompare(b.askedAt))
  const legacy = conversation.pendingDecision

  if (!legacy) return []
  const { toolCallId, ...rest } = legacy

  return [{ ...rest, id: toolCallId, status: 'open' }]
}

/** Shown beside a row's title when the conversation waits on several questions; one shows none. */
export function openQuestionCount(open: number): string | null {
  return open > 1 ? t('{count} questions', { count: open }) : null
}
