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

export function botIsOnboarding(conversation: Pick<AgentConversation, 'botOnboarding'>): boolean {
  return conversation.botOnboarding === 'pending' || conversation.botOnboarding === 'active'
}

/** Chat keeps all questions; work surfaces exclude initial setup preferences. */
export function attentionInputRequests(
  conversation: Pick<AgentConversation, 'inputRequests' | 'botOnboarding'>,
): AgentInputRequest[] {
  return openInputRequests(conversation).filter(
    (request) => !botIsOnboarding(conversation) || request.category !== 'preference',
  )
}
