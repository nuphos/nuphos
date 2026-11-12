import { queryClient } from '../../lib/query/client'
import { queryKeys } from '../../lib/query/keys'

import type { AgentConversation } from '../../api'

export const SECTION_LABEL = 'px-1 text-[11px] font-medium text-tertiary'

/** The agents the viewer owns, as the sidebar last listed them: the ones they may add. */
export function ownAgents(teamId: string, viewerId: string): AgentConversation[] {
  return (
    queryClient.getQueryData<AgentConversation[]>(queryKeys.agentSessions(teamId)) ?? []
  ).filter(
    (conversation) =>
      conversation.kind !== 'channel' &&
      (conversation.owner?.id ?? (conversation.isOwner ? viewerId : '')) === viewerId,
  )
}
