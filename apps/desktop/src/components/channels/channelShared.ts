import { queryClient } from '../../lib/query/client.ts'
import { queryKeys } from '../../lib/query/keys.ts'

import type { AgentConversation } from '../../api'

export const SECTION_LABEL = 'px-1 text-[11px] font-medium text-tertiary'

function listed(teamId: string): AgentConversation[] {
  return queryClient.getQueryData<AgentConversation[]>(queryKeys.agentSessions(teamId)) ?? []
}

/** A conversation as the sidebar last listed it: what is known of it before it loads. */
export function listedConversation(
  teamId: string,
  sessionId: string | undefined,
): AgentConversation | undefined {
  return listed(teamId).find((conversation) => conversation.sessionId === sessionId)
}

/** The agents the viewer owns, as the sidebar last listed them: the ones they may add. */
export function ownAgents(teamId: string, viewerId: string): AgentConversation[] {
  return listed(teamId).filter(
    (conversation) =>
      conversation.kind !== 'channel' &&
      (conversation.owner?.id ?? (conversation.isOwner ? viewerId : '')) === viewerId,
  )
}
