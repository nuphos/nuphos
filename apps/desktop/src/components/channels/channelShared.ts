import { readSwrCache } from '../../lib/swrCache'
import { agentSessionsCacheKey } from '../sidebar/state'

import type { AgentConversation } from '../../api'

export const SECTION_LABEL = 'px-1 text-[11px] font-medium text-tertiary'
export const ROW = 'flex h-7 items-center gap-2 rounded-md px-1 text-[13px]'

/** The agents the viewer owns, as the sidebar last listed them: the ones they may add. */
export function ownAgents(teamId: string, viewerId: string): AgentConversation[] {
  return (readSwrCache<AgentConversation[]>(agentSessionsCacheKey(teamId)) ?? []).filter(
    (conversation) =>
      conversation.kind !== 'channel' &&
      (conversation.owner?.id ?? (conversation.isOwner ? viewerId : '')) === viewerId,
  )
}
