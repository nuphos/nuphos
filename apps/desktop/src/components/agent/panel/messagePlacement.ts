import type { Message } from './model'

/**
 * Where something that happened at `at` sits among the loaded messages: the
 * index of the first message newer than it, or -1 when none is. That slot is
 * right after the last message stamped at or before `at`. A message without a
 * stamp has not been stored yet — the reply still streaming, or one whose
 * stored time has not been read back — so it is never measured against; it
 * counts as newer than every stamped message before it and older than the
 * next stamped one. The one rule timeline events and download cards share, so
 * an item keeps its place when a stamp arrives.
 */
export function firstMessageNewerThan(
  messages: readonly { createdAt?: number }[],
  at: number,
): number {
  const index =
    messages.findLastIndex(
      (message) => message.createdAt !== undefined && message.createdAt <= at,
    ) + 1

  return index < messages.length ? index : -1
}

// Client-side stand-in for the backend's first-persisted time (turn end):
// stamps the just-finished turn's assistant message so the hover timestamp
// renders without a reload. That reply is the last assistant message, not
// necessarily the last message — user messages from other sessions can land
// after it before the turn ends — and placement (see messagePlacement) relies
// on every finished reply holding its stamp.
export function stampAssistantTurnEnd(messages: Message[]): Message[] {
  const index = messages.findLastIndex((message) => message.role === 'assistant')
  const reply = messages[index]

  if (!reply || reply.createdAt) return messages

  return messages.with(index, { ...reply, createdAt: Date.now() })
}
