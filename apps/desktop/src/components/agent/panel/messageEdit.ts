import type { Message } from './model'

/**
 * Edit re-sends a message as yours, so only your own plain messages qualify: not a
 * teammate's or a Slack sender's, and not a plan approval, which must reach the agent
 * as an approval. A message without a sender predates attribution and is the owner's.
 */
export function canEditMessage(
  message: Pick<Message, 'turnKind' | 'metadata'>,
  currentUserId: string | undefined,
  foreignChat: boolean,
): boolean {
  if (message.turnKind === 'plan-approval') return false
  const senderId = message.metadata?.sender.id

  return senderId ? senderId === currentUserId : !foreignChat
}
