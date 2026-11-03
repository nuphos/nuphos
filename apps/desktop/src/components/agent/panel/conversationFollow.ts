import { isShownMessage } from './turnBoundaries.ts'

import type { Message } from './model.ts'

/**
 * The reader's own send. A teammate's, a Slack sender's, or another agent's message
 * is not, even though it is a user turn. A message without a sender predates
 * attribution and is the owner's.
 */
export function isOwnMessage(
  message: Pick<Message, 'role' | 'metadata'> | undefined,
  currentUserId: string | undefined,
  foreignChat = false,
): boolean {
  if (message?.role !== 'user') return false
  const senderId = message.metadata?.sender.id

  return senderId ? senderId === currentUserId : !foreignChat
}

/**
 * What new content does to the view: your own send always takes you to it; anything
 * else follows only a reader who is at (or near) the bottom and hasn't scrolled up
 * to read history. Otherwise the view stays put and the jump button marks it unseen.
 */
export function followNewContent({
  ownSend,
  lockedToHistory,
  following,
  nearBottom,
}: {
  ownSend: boolean
  lockedToHistory: boolean
  following: boolean
  nearBottom: boolean
}): 'follow' | 'stay' {
  if (ownSend) return 'follow'
  if (lockedToHistory) return 'stay'

  return following || nearBottom ? 'follow' : 'stay'
}

/** Shown messages after the last one the reader saw at the bottom. */
export function unseenMessageCount(messages: Message[], readThroughId: string | null): number {
  if (!readThroughId) return 0
  const at = messages.findIndex((m) => m.id === readThroughId)

  if (at < 0) return 0

  return messages.slice(at + 1).filter(isShownMessage).length
}
