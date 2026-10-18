import { writeSwrCache } from './swrCache'

import type { AgentConversation, AgentConversationDetail } from '../api/agent-types'

/** The chat AgentPanel last opened for a session, without its transcript. */
export function openedConversationCacheKey(sessionId: string): string {
  return `opened-conversation:${sessionId}`
}

// Panels beside the transcript read this instead of the sidebar lists, which
// leave out archived chats. The stored credential selection can predate newer
// credential kinds, so it is kept as the transcript reconciled it.
export function rememberOpenedConversation(
  detail: AgentConversationDetail,
  credentialAccess: AgentConversation['credentialAccess'],
): void {
  const { messages: _messages, ...rest } = detail
  const conversation = { ...rest, credentialAccess }

  writeSwrCache(
    openedConversationCacheKey(detail.sessionId),
    conversation satisfies AgentConversation,
  )
}
