import { queryKeys } from '../../lib/query/keys.ts'

import type { AgentMemoryPage } from '../../api/agent-audit-types.ts'
import type { InfiniteData, QueryClient } from '@tanstack/react-query'

type Pages = InfiniteData<AgentMemoryPage>

/** A memory removed or restored leaves the list shown at once. The other state's list (removed
 *  versus live) now lacks or holds it, so it is read again when next shown. */
export function removeMemory(
  client: QueryClient,
  teamId: string,
  scope: string,
  state: string,
  id: string,
) {
  void client.invalidateQueries({
    queryKey: queryKeys.memoryScope(teamId, scope),
    refetchType: 'none',
  })
  client.setQueryData<Pages>(
    queryKeys.memories(teamId, scope, state),
    (data) =>
      data && {
        ...data,
        pages: data.pages.map((page) => ({
          ...page,
          memories: page.memories.filter((memory) => memory.id !== id),
        })),
      },
  )
}
