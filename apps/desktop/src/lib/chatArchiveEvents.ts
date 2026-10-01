const CHAT_UNARCHIVED_EVENT = 'nuphos:chat-unarchived'

export function announceChatUnarchived(sessionId: string): void {
  window.dispatchEvent(new CustomEvent(CHAT_UNARCHIVED_EVENT, { detail: { sessionId } }))
}

export function onChatUnarchived(listener: (sessionId: string) => void): () => void {
  const handle = (event: Event) => {
    const sessionId = (event as CustomEvent<{ sessionId?: unknown } | null>).detail?.sessionId

    if (typeof sessionId === 'string') listener(sessionId)
  }

  window.addEventListener(CHAT_UNARCHIVED_EVENT, handle)

  return () => window.removeEventListener(CHAT_UNARCHIVED_EVENT, handle)
}
