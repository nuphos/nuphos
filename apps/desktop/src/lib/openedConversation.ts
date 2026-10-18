import { writeSwrCache } from './swrCache'

import type { AgentConversation, AgentConversationDetail } from '../api/agent-types'

/** The chat AgentPanel last opened for a session, without its transcript. */
export function openedConversationCacheKey(sessionId: string): string {
  return `opened-conversation:${sessionId}`
}

// Panels beside the transcript read this instead of the sidebar lists, which
// leave out archived chats.
export function rememberOpenedConversation(detail: AgentConversationDetail): void {
  const { messages: _messages, ...conversation } = detail

  writeSwrCache(
    openedConversationCacheKey(detail.sessionId),
    conversation satisfies AgentConversation,
  )
}
