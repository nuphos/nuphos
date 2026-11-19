// The backend's push of which conversations changed (#3523): a Bot chat on screen reads
// again as soon as it changes, instead of on a 4 s poll.
import { useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'

import { queryKeys } from '../../lib/query/keys.ts'

import type { QueryClient } from '@tanstack/react-query'

type Change = { teamId: string; sessionId: string | null; connected?: boolean }

// Teams whose push stream is up. Any other team's chats poll: before the first connect, while
// it is down (an error, a proxy that blocks it), or on a backend without it (#3914).
const connected = new Set<string>()

/** Whether a team's chats hear of their changes now, so they need no poll. */
export const pushed = (teamId: string) => connected.has(teamId)

type Cached = { agents?: { sessionId: string }[] } | undefined

/**
 * One change: that chat reads again, and so does every chat that has it as a member, which shows
 * its name and face (renaming a Bot renames its chat). The stream coming up or going down reads
 * every chat of the team again, which also starts or stops its poll.
 */
export function applyChange(client: QueryClient, { teamId, sessionId, connected: up }: Change) {
  if (up === true) connected.add(teamId)
  if (up === false) connected.delete(teamId)
  void client.invalidateQueries({
    queryKey: [...queryKeys.team(teamId), 'channel'],
    predicate: ({ queryKey, state }) =>
      sessionId === null ||
      queryKey.at(-1) === sessionId ||
      (state.data as Cached)?.agents?.some((agent) => agent.sessionId === sessionId) === true,
  })
}

let listening = false

/** Follows a team's changes for as long as the app runs; any number of panes may ask. */
export function useAgentChanges(teamId: string) {
  const client = useQueryClient()

  useEffect(() => {
    if (!listening) {
      listening = true
      window.api.onAgentChanges((change) => applyChange(client, change))
    }
    void window.api.agentFollowChanges(teamId)
  }, [client, teamId])
}
