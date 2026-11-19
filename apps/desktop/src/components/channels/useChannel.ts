import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useContext, useEffect } from 'react'

import { api } from '../../api.ts'
import { WorkspaceTabContext } from '../../hooks/useWorkspaceTab.ts'
import { useChatSwitchShown } from '../../lib/chatSwitchTiming.ts'
import { queryKeys } from '../../lib/query/keys.ts'

import { pushed, useAgentChanges } from './agentChanges.ts'
import { channelRevision } from './channelRevision.ts'
import { listedConversation } from './channelShared.ts'

import type { AgentConversation, AgentConversationDetail, ChannelAgent } from '../../api'
import type { QueryClient, QueryState } from '@tanstack/react-query'

// Only for a backend that predates the push of changes (agentChanges.ts, #3914).
const POLL_MS = 4_000
const RETRY_MAX_MS = 60_000
const TAIL = 200

type Channel = { detail: AgentConversationDetail; agents: ChannelAgent[]; revision: string }

/** With a copy on hand, a cheap probe first and the rest only when it shows a change. */
export async function loadChannel(client: QueryClient, teamId: string, channelId: string) {
  const last = client.getQueryData<Channel>(queryKeys.channel(teamId, channelId))
  const all = async () => {
    const [detail, listed] = await Promise.all([
      api.agentGetConversation(channelId, teamId, { tail: TAIL, runtimeState: 'omit' }),
      api.agentListChannelAgents(channelId, teamId),
    ])

    return { detail, agents: listed.agents, revision: channelRevision(detail) }
  }

  if (!last) return all()
  const probe = await api.agentGetConversation(channelId, teamId, {
    tail: 1,
    messages: 'omit',
    runtimeState: 'omit',
  })

  return last.revision === channelRevision(probe) ? last : all()
}

/** Loads a Bot chat before it is opened, so it opens from memory. */
export function prefetchChannel(client: QueryClient, teamId: string, channelId: string) {
  const queryKey = queryKeys.channel(teamId, channelId)

  // One that failed (a chat left or deleted) is read again only when it is opened.
  if (client.getQueryState(queryKey)?.status === 'error') return
  client
    .query({
      queryKey,
      queryFn: () => loadChannel(client, teamId, channelId),
      gcTime: Infinity,
      retry: false,
    })
    .catch(() => {})
}

/** The three most recent Bot chats, loaded once the sidebar lists them, so they open from memory. */
export function usePrefetchRecentChannels(teamId: string, listed: AgentConversation[] | undefined) {
  const client = useQueryClient()
  const loaded = listed !== undefined

  useEffect(() => {
    if (!loaded) return
    const recent = (client.getQueryData<AgentConversation[]>(queryKeys.agentSessions(teamId)) ?? [])
      .filter((row) => row.kind === 'channel')
      .sort((a, b) => Date.parse(b.lastActiveAt) - Date.parse(a.lastActiveAt))
      .slice(0, 3)

    for (const row of recent) prefetchChannel(client, teamId, row.sessionId)
  }, [client, teamId, loaded])
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
 * A channel's messages and agents, read again when the backend says it changed (or polled
 * from a backend that predates that). A failing channel backs off, longer the longer it has failed.
 */
export function useChannel(teamId: string, channelId: string) {
  const client = useQueryClient()

  useAgentChanges(teamId)
  // A background workspace tab stays mounted but hidden; outside any tab, the pane is on screen.
  const tab = useContext(WorkspaceTabContext)
  const { data } = useQuery({
    queryKey: queryKeys.channel(teamId, channelId),
    queryFn: () => loadChannel(client, teamId, channelId),
    enabled: tab ? tab.isActive : true,
    retry: false,
    // Kept for as long as the app runs: a chat opened an hour ago opens from memory too.
    gcTime: Infinity,
    // No poll where the backend pushes changes; a failing read still retries.
    refetchInterval: (query) =>
      query.state.status !== 'error' && pushed(teamId) ? false : channelRetryMs(query.state),
  })

  const refresh = useCallback(
    () => void refreshChannel(client, teamId, channelId),
    [client, teamId, channelId],
  )

  const detail = data?.detail ?? null

  useChatSwitchShown(channelId, 'bot', detail !== null)

  // Until the chat loads, the sidebar's row says its name and its Bot, so the header and
  // the composer open as they will stay.
  return {
    detail,
    chat: detail ?? listedConversation(teamId, channelId),
    agents: data?.agents ?? [],
    refresh,
  }
}
