import { useCallback, useSyncExternalStore } from 'react'

import type { AgentConversation, AgentConversationDetail } from '../api/agent-types'

// The chats AgentPanel opened, without their transcripts. Panels beside the
// transcript read these instead of the sidebar lists, which leave out archived
// chats. Kept apart from the view cache so its eviction can't drop one silently.
const MAX_OPENED = 20
const opened = new Map<string, AgentConversation>()
const listeners = new Set<() => void>()

export function rememberOpenedConversation(detail: AgentConversationDetail): void {
  const { messages: _messages, ...conversation } = detail

  opened.delete(detail.sessionId)
  opened.set(detail.sessionId, conversation)
  if (opened.size > MAX_OPENED) {
    const oldest = opened.keys().next().value

    if (oldest !== undefined) opened.delete(oldest)
  }
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void) {
  listeners.add(listener)

  return () => {
    listeners.delete(listener)
  }
}

/** The chat as AgentPanel last opened it, if it did. */
export function useOpenedConversation(sessionId: string): AgentConversation | undefined {
  return useSyncExternalStore(
    subscribe,
    useCallback(() => opened.get(sessionId), [sessionId]),
  )
}
