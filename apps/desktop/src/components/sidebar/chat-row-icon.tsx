import { AgentAvatar } from '../agent/AgentAvatar'
import { ChannelMark } from '../channels/channelParts'

import type { Item } from './types'
import type { AgentConversation } from '../../api'

/** Agent identity and current Runtime; execution status lives in ChatRowStatus. */
export function chatRowIcon(conversation: AgentConversation): Pick<Item, 'icon' | 'iconNode'> {
  // A channel is never an agent, so it never wears one's face.
  if (conversation.kind === 'channel') return { iconNode: <ChannelMark size={22} /> }

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
