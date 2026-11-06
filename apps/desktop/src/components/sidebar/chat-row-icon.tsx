import { AgentAvatar } from '../agent/AgentAvatar'
import { ChatIcon } from '../channels/channelParts'

import { SharedByBadge } from './SharedByBadge'

import type { Item } from './types'
import type { AgentConversation } from '../../api'

/** A chat's faces, or a session's Runtime; execution status lives in ChatRowStatus. */
export function chatRowIcon(conversation: AgentConversation): Pick<Item, 'icon' | 'iconNode'> {
  // A chat wears its members' faces, never an agent's own.
  if (conversation.kind === 'channel')
    return { iconNode: <ChatIcon faces={conversation.faces} title={conversation.title} sidebar /> }

  // A session row is its Runtime; faces belong to chats.
  const runtime = (
    <AgentAvatar
      agentId={conversation.sessionId}
      provider={conversation.agentRuntime}
      face={false}
      sidebar
    />
  )

  // An agent shared with the viewer wears its owner's face too.
  if (conversation.isOwner !== false || !conversation.owner) return { iconNode: runtime }

  return {
    iconNode: (
      <span className="relative inline-flex shrink-0">
        {runtime}
        <SharedByBadge owner={conversation.owner} />
      </span>
    ),
  }
}
