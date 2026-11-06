import { Hash } from 'lucide-react'

import { AgentAvatar } from '../agent/AgentAvatar'

import { SharedByBadge } from './SharedByBadge'

import type { Item } from './types'
import type { AgentConversation } from '../../api'

/** Agent identity and current Runtime; execution status lives in ChatRowStatus. */
export function chatRowIcon(conversation: AgentConversation): Pick<Item, 'icon' | 'iconNode'> {
  // A chat is a place, not a person: it wears a channel mark. Faces are for agents.
  if (conversation.kind === 'channel')
    return {
      iconNode: (
        <span className="inline-flex size-[22px] shrink-0 items-center justify-center rounded-md bg-surface-sunken text-secondary">
          <Hash className="size-3.5" strokeWidth={1.75} aria-hidden />
        </span>
      ),
    }

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
