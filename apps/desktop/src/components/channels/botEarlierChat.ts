import type { AgentConversation } from '../../api/agent-types.ts'

/**
 * Whether a Bot's chat should lead back to the Bot's own session, where the
 * conversation it had before this chat was made still is (#5061). A Bot used
 * before Bot chats were channels kept its messages there, and its first chat
 * is made empty the first time it is opened. A Bot whose session only moved
 * once this chat existed, such as a new Bot greeting in it, has nothing earlier.
 */
export function hasEarlierBotChat(
  bot: Pick<AgentConversation, 'messageCount' | 'lastActiveAt'> | undefined,
  chat: Pick<AgentConversation, 'createdAt'> | null | undefined,
): boolean {
  if (!bot || !chat || bot.messageCount <= 0) return false
  const made = Date.parse(chat.createdAt)
  const lastActive = Date.parse(bot.lastActiveAt)

  return Number.isFinite(made) && Number.isFinite(lastActive) && lastActive < made
}
