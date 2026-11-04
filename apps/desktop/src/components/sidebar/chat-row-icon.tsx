import { AgentAvatar } from '../agent/AgentAvatar'
import { ChannelMark } from '../channels/channelParts'

import { SharedByBadge } from './SharedByBadge'

import type { Item } from './types'
import type { AgentConversation } from '../../api'

/** Agent identity and current Runtime; execution status lives in ChatRowStatus. */
export function chatRowIcon(conversation: AgentConversation): Pick<Item, 'icon' | 'iconNode'> {
  // A channel is never an agent, so it never wears one's face.
  if (conversation.kind === 'channel') return { iconNode: <ChannelMark size={22} /> }

  const avatar = (
    <AgentAvatar
      agentId={conversation.sessionId}
      avatar={conversation.avatar}
      provider={conversation.agentRuntime}
      sidebar
      animated
    />
  )

  // An agent shared with the viewer wears its owner's face too.
  if (conversation.isOwner !== false || !conversation.owner) return { iconNode: avatar }

  return {
    iconNode: (
      <span className="relative inline-flex shrink-0">
        {avatar}
        <SharedByBadge owner={conversation.owner} />
      </span>
    ),
  }
}
