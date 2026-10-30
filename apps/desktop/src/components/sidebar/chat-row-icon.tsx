import { AgentAvatar } from '../agent/AgentAvatar'
import { ChannelMark } from '../channels/channelParts'

import type { Item } from './types'
import type { AgentConversation } from '../../api'

/** Agent identity and current Runtime; execution status lives in ChatRowStatus. */
export function chatRowIcon(conversation: AgentConversation): Pick<Item, 'icon' | 'iconNode'> {
  // A channel with just one agent wears that agent's face; any other, the hash.
  if (conversation.kind === 'channel') {
    const [only, ...more] = conversation.agentSessionIds ?? []

    return {
      iconNode:
        only && more.length === 0 ? (
          <AgentAvatar agentId={only} sidebar />
        ) : (
          <ChannelMark size={22} />
        ),
    }
  }

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
