const CHAT_UNARCHIVED_EVENT = 'nuphos:chat-unarchived'
const CHAT_ARCHIVED_EVENT = 'nuphos:chat-archived'

export type ChatArchiveChange = { sessionId: string; teamId: string }

export function announceChatArchived(change: ChatArchiveChange): void {
  window.dispatchEvent(new CustomEvent(CHAT_ARCHIVED_EVENT, { detail: change }))
}

export function onChatArchived(listener: (change: ChatArchiveChange) => void): () => void {
  const handle = (event: Event) => listener((event as CustomEvent<ChatArchiveChange>).detail)

  window.addEventListener(CHAT_ARCHIVED_EVENT, handle)

  return () => window.removeEventListener(CHAT_ARCHIVED_EVENT, handle)
}

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
