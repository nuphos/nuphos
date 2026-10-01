const EVENT = 'nuphos:chat-title-changed'

export type ChatTitleChange = { sessionId: string; teamId: string; title: string }

export function announceChatTitle(change: ChatTitleChange) {
  window.dispatchEvent(new CustomEvent(EVENT, { detail: change }))
}

export function onChatTitleChanged(listener: (change: ChatTitleChange) => void) {
  const handle = (event: Event) => listener((event as CustomEvent<ChatTitleChange>).detail)

  window.addEventListener(EVENT, handle)

  return () => window.removeEventListener(EVENT, handle)
}
