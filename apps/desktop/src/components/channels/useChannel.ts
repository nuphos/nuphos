import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useContext } from 'react'

import { api } from '../../api.ts'
import { WorkspaceTabContext } from '../../hooks/useWorkspaceTab.ts'
import { queryKeys } from '../../lib/query/keys.ts'

import { channelRevision } from './channelRevision.ts'

import type { AgentConversationDetail, ChannelAgent } from '../../api'
import type { QueryClient, QueryState } from '@tanstack/react-query'

// Like an open conversation: new posts from people and agents show within a few seconds.
const POLL_MS = 4_000
const RETRY_MAX_MS = 60_000
const TAIL = 200

type Channel = { detail: AgentConversationDetail; agents: ChannelAgent[]; revision: string }

/** A cheap probe first; the messages and agents only when it shows a change. */
export async function loadChannel(client: QueryClient, teamId: string, channelId: string) {
  const last = client.getQueryData<Channel>(queryKeys.channel(teamId, channelId))
  const probe = await api.agentGetConversation(channelId, teamId, {
    tail: 1,
    messages: 'omit',
    runtimeState: 'omit',
  })
  const revision = channelRevision(probe)

  if (last?.revision === revision) return last
  const [detail, listed] = await Promise.all([
    api.agentGetConversation(channelId, teamId, { tail: TAIL, runtimeState: 'omit' }),
    api.agentListChannelAgents(channelId, teamId),
  ])

  return { detail, agents: listed.agents, revision }
}

/** After a post or an agent change, from any pane showing the channel: fetch it all now. */
export function refreshChannel(client: QueryClient, teamId: string, channelId: string) {
  const queryKey = queryKeys.channel(teamId, channelId)

  client.setQueryData<Channel>(queryKey, (last) => last && { ...last, revision: '' })

  return client.invalidateQueries({ queryKey, exact: true })
}

/** While failing, wait longer the longer it has failed: by how long since the last success,
 *  or for a channel that never loaded, by how many times it failed (8, 16, 32, then 60 s). */
export function channelRetryMs(state: QueryState<Channel>): number {
  if (state.status !== 'error') return POLL_MS
  // From timestamps fixed per attempt: a rerender re-arms the timer whenever this changes.
  const failingFor = state.dataUpdatedAt
    ? state.errorUpdatedAt - state.dataUpdatedAt
    : POLL_MS * 2 ** state.errorUpdateCount

  return Math.min(RETRY_MAX_MS, Math.max(2 * POLL_MS, failingFor))
}

/**
 * A channel's messages and agents, polled while it is on screen and the window is
 * visible. A failing channel backs off, longer the longer it has failed.
 */
export function useChannel(teamId: string, channelId: string) {
  const client = useQueryClient()
  // A background workspace tab stays mounted but hidden; outside any tab, the pane is on screen.
  const tab = useContext(WorkspaceTabContext)
  const { data } = useQuery({
    queryKey: queryKeys.channel(teamId, channelId),
    queryFn: () => loadChannel(client, teamId, channelId),
    enabled: tab ? tab.isActive : true,
    retry: false,
    refetchInterval: (query) => channelRetryMs(query.state),
  })

  const refresh = useCallback(
    () => void refreshChannel(client, teamId, channelId),
    [client, teamId, channelId],
  )

  return { detail: data?.detail ?? null, agents: data?.agents ?? [], refresh }
}
