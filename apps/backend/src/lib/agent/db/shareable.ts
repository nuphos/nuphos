import { AppError } from '@/lib/errors'

import { isBot } from './access'
import { isBotChat } from './archive'
import { openedByAgent } from './watch'

import type { AgentConversation } from './shared'

/**
 * Only a group chat, or a Task a person opened by hand, is shared: never a Bot,
 * its chat, or what an agent, a trigger or a chat channel opened.
 */
export function isShareable(conversation: AgentConversation): boolean {
  return conversation.kind === 'channel'
    ? !isBotChat(conversation)
    : !isBot(conversation) &&
        !openedByAgent({ ...conversation.metadata, parentSessionId: conversation.parentSessionId })
}

export function assertShareable(conversation: AgentConversation) {
  if (!isShareable(conversation))
    throw new AppError(403, 'not_shareable', 'Only a Task you opened yourself can be shared')

  return conversation
}
