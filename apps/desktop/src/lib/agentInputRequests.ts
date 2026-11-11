import { t } from '../i18n/index.ts'

import type { AgentConversation, AgentInputRequest } from '../api/agent-types.ts'

/** A conversation's open questions, oldest first. */
export function openInputRequests(
  conversation: Pick<AgentConversation, 'inputRequests'>,
): AgentInputRequest[] {
  return (conversation.inputRequests ?? [])
    .filter((request) => request.status === 'open')
    .sort((a, b) => a.askedAt.localeCompare(b.askedAt))
}

/** Shown beside a row's title when the conversation waits on several questions; one shows none. */
export function openQuestionCount(open: number): string | null {
  return open > 1 ? t('{count} questions', { count: open }) : null
}
