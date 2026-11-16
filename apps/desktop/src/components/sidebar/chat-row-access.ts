import type { Item } from './types'
import type { AgentConversation } from '../../api/agent-types.ts'

/**
 * What an agent row offers a viewer who does not own it. Renaming and nesting
 * stay the owner's; archiving hides the agent for everyone, so only a manager
 * may do it. A group chat someone else made is one the viewer leaves instead.
 */
export function chatRowAccess(
  conversation: Pick<AgentConversation, 'kind' | 'isOwner' | 'canManage'>,
): Pick<Item, 'readOnlyChat' | 'managedChat' | 'joinedChat'> {
  if (conversation.kind === 'channel')
    return conversation.isOwner === false ? { joinedChat: true } : {}
  if (conversation.isOwner !== false) return {}

  return { readOnlyChat: true, ...(conversation.canManage ? { managedChat: true } : {}) }
}
