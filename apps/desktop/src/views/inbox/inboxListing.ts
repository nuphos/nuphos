import { queryOptions } from '@tanstack/react-query'

import { api } from '../../api.ts'
import { onInputRequestsRefresh } from '../../lib/inputRequestRefresh.ts'
import { queryClient } from '../../lib/query/client.ts'
import { queryKeys } from '../../lib/query/keys.ts'

import type { AgentConversation } from '../../api/agent-types'

// Bounded, as the other listings are: a cursor never repeats a page.
const MAX_PAGES = 10

/** Every page of the team's readable conversations with an open question. */
async function listPending(teamId: string): Promise<AgentConversation[]> {
  const conversations: AgentConversation[] = []
  let cursor: string | undefined

  for (let page = 0; page < MAX_PAGES; page++) {
    const listed = await api.agentListConversations(teamId, {
      scope: 'team',
      pendingDecision: true,
      archived: 'exclude',
      limit: 100,
      cursor,
    })

    conversations.push(...listed.conversations)
    const next = listed.nextCursor ?? undefined

    if (!next || next === cursor) break
    cursor = next
  }

  return conversations
}

export const inboxListingQuery = (teamId: string) =>
  queryOptions({
    queryKey: queryKeys.inbox(teamId),
    queryFn: () => listPending(teamId),
    staleTime: 0,
  })

// The moments a question may have been asked, answered or dismissed reload the listing shown.
const isListing = (query: { queryKey: readonly unknown[] }) =>
  query.queryKey[0] === 'team' && query.queryKey[2] === 'inbox'
const queued = new Set<string>()

/** A listing already running may predate what was asked, so it is joined, not cancelled (a burst
 *  would cancel every read), and read once more after it lands. Each listing queues on its own,
 *  so a slow read for one team never holds back another's. */
export function reloadListings(client = queryClient) {
  for (const { queryKey, queryHash, state } of client.getQueryCache().findAll({
    predicate: isListing,
  })) {
    if (queued.has(queryHash)) continue
    const reload = () =>
      client.invalidateQueries({ queryKey, exact: true }, { cancelRefetch: false })

    if (state.fetchStatus !== 'fetching') {
      void reload()
      continue
    }
    queued.add(queryHash)
    void reload().finally(() => {
      queued.delete(queryHash)
      void reload()
    })
  }
}

onInputRequestsRefresh(() => reloadListings())
