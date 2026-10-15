import { api } from '../../api'
import { useAgentRuntimeStates } from '../../lib/agentRuntimeStates'
import { readSwrCache } from '../../lib/swrCache'
import { agentSessionsCacheKey } from '../sidebar/state'
import { useArchiveOffer } from '../sidebar/use-archive-offer'

import type { AgentConversation } from '../../api'

/**
 * The titlebar's archive asks about finished threads the same way the sidebar
 * does. It re-reads the chat list first: the sidebar's cached copy may be empty
 * (a deep link) or older than a thread made since.
 */
export function useHeaderArchiveOffer(
  teamId: string,
  archive: (threadIds: string[]) => Promise<boolean>,
) {
  const runtimeStates = useAgentRuntimeStates()
  const offer = useArchiveOffer({
    conversations: readSwrCache<AgentConversation[]>(agentSessionsCacheKey(teamId)) ?? [],
    runtimeStates,
    onArchive: (_sessionId, threadIds) => archive(threadIds),
  })

  return {
    dialog: offer.dialog,
    request: (sessionId: string) => {
      void api
        .agentListConversations(teamId, { scope: 'mine', limit: 200 })
        .then(
          (page) => page.conversations,
          () => undefined,
        )
        .then((fresh) => offer.request(sessionId, fresh))
    },
  }
}
