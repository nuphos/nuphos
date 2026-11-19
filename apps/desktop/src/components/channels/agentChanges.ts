// The backend's push of which conversations changed (#3523): a Bot chat on screen reads
// again as soon as it changes, instead of on a 4 s poll.
import { useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'

import { queryKeys } from '../../lib/query/keys.ts'

import type { QueryClient } from '@tanstack/react-query'

type Change = { teamId: string; sessionId: string | null; supported?: false }

// Teams whose backend predates the push (before #3906, the first backend release after
// 0.145.4): their chats keep polling. Version compatibility only; deleted in #3914.
const unpushed = new Set<string>()

/** Whether a team's chats hear of their changes, so they need no poll. */
export const pushed = (teamId: string) => !unpushed.has(teamId)

/** One change: that chat reads again, or, after a reconnect, every chat of the team does. */
export function applyChange(client: QueryClient, { teamId, sessionId, supported }: Change) {
  if (supported === false) unpushed.add(teamId)
  void client.invalidateQueries({
    queryKey: sessionId
      ? queryKeys.channel(teamId, sessionId)
      : [...queryKeys.team(teamId), 'channel'],
    exact: sessionId !== null,
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
