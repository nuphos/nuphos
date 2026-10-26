import { AgentAvatar } from '../agent/AgentAvatar'

import type { Item } from './types'
import type { AgentConversation } from '../../api'

/** Agent identity and current Runtime; execution status lives in ChatRowStatus. */
export function chatRowIcon(conversation: AgentConversation): Pick<Item, 'icon' | 'iconNode'> {
  return {
    iconNode: (
      <AgentAvatar
        agentId={conversation.sessionId}
        avatar={conversation.avatar}
        provider={conversation.agentRuntime}
        sidebar
        animated
      />
    ),
  }
}
