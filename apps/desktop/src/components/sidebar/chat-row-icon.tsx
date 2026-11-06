import { AgentAvatar } from '../agent/AgentAvatar'
import { ChatIcon } from '../channels/channelParts'

import { SharedByBadge } from './SharedByBadge'

import type { Item } from './types'
import type { AgentConversation } from '../../api'

/** Agent identity and current Runtime; execution status lives in ChatRowStatus. */
export function chatRowIcon(conversation: AgentConversation): Pick<Item, 'icon' | 'iconNode'> {
  // A chat wears its members' faces, never an agent's own.
  if (conversation.kind === 'channel')
    return { iconNode: <ChatIcon faces={conversation.faces} title={conversation.title} sidebar /> }

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
