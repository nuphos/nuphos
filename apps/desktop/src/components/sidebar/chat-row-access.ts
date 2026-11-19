import type { Item } from './types'
import type { AgentConversation } from '../../api/agent-types.ts'

/**
 * What an agent row offers a viewer who does not own it. Renaming and nesting
 * stay the owner's; archiving hides the agent for everyone, so only a manager
 * may do it. Anyone else leaves it, which hides it only for them. A channel
 * keeps its own rules.
 */
export function chatRowAccess(
  conversation: Pick<AgentConversation, 'kind' | 'isOwner' | 'canManage'>,
): Pick<Item, 'readOnlyChat' | 'managedChat' | 'leavable'> {
  if (conversation.kind === 'channel' || conversation.isOwner !== false) return {}

  return {
    readOnlyChat: true,
    ...(conversation.canManage ? { managedChat: true } : { leavable: true }),
  }
}
