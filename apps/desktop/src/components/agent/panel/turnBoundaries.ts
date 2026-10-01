import type { Message, Tab } from './model.ts'
import type { Part } from './parts.ts'

/** Stream output extends the open assistant message. A user message closes it,
 * so the next output opens a new one. Returns `messages` itself when nothing
 * changed. */
export function updateCurrentAssistantParts(
  messages: Message[],
  newId: () => string,
  update: (parts: Part[]) => Part[],
): Message[] {
  const last = messages.at(-1)
  const open = last?.role === 'assistant' ? last : undefined
  const parts = open?.parts ?? []
  const nextParts = update(parts)

  if (nextParts === parts) return messages
  if (open) return [...messages.slice(0, -1), { ...open, parts: nextParts }]

  return [...messages, { id: newId(), role: 'assistant', parts: nextParts }]
}

/**
 * Applies a run's turn-start frame: the user input that opened the run. The
 * device that sent it already holds it and keeps its own copy. Any other
 * device appends it, which closes the previous answer. Whatever followed the
 * input locally is dropped, since the replay that carries this frame rebuilds
 * it from frame 0.
 */
export function startUserTurn(tab: Tab, streamId: string, input: Message[]): Tab {
  if (tab.streamId !== streamId) return tab
  const users = input.filter((message) => message.role === 'user')

  if (users.length === 0) return tab
  const ids = new Set(users.map((message) => message.id))
  const anchor = tab.messages.findIndex((message) => ids.has(message.id))
  const local = new Map(tab.messages.map((message) => [message.id, message]))
  const messages = [
    ...(anchor < 0 ? tab.messages : tab.messages.slice(0, anchor)),
    ...users.map((message) => {
      const own = local.get(message.id)

      return own ? (message.metadata ? { ...own, metadata: message.metadata } : own) : message
    }),
  ]

  if (
    messages.length === tab.messages.length &&
    messages.every((message, index) => message === tab.messages[index])
  )
    return tab

  return { ...tab, messages }
}
