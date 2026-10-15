import { archiveChat } from '../../lib/archiveChat'
import { useAgentRuntimeStates } from '../../lib/agentRuntimeStates'
import { announceChatArchived } from '../../lib/chatArchiveEvents'
import { readSwrCache } from '../../lib/swrCache'
import { agentSessionsCacheKey } from '../sidebar/state'
import { useArchiveOffer } from '../sidebar/use-archive-offer'
import { toast } from '../ui/toast'

import type { AgentConversation } from '../../api'

/**
 * The titlebar's archive asks about finished threads the same way the sidebar
 * does, reading the threads from the sidebar's cached chat list.
 */
export function useHeaderArchiveOffer(teamId: string, archive: () => Promise<boolean>) {
  const runtimeStates = useAgentRuntimeStates()

  return useArchiveOffer({
    conversations: readSwrCache<AgentConversation[]>(agentSessionsCacheKey(teamId)) ?? [],
    runtimeStates,
    onArchive: async (_sessionId, threadIds) => {
      if (!(await archive())) return
      await Promise.all(
        threadIds.map((id) =>
          archiveChat(id, teamId)
            .then(() => announceChatArchived({ sessionId: id, teamId }))
            .catch((error: unknown) => toast.apiError('Could not archive thread', error)),
        ),
      )
    },
  })
}
