import { useCallback, useContext, useRef, useSyncExternalStore } from 'react'

import { api } from '../../api'
import { pollSnapshot, refreshPoll, subscribePoll } from '../../hooks/sharedPoll'
import { WorkspaceTabContext } from '../../hooks/useWorkspaceTab'

import type { AgentConversationDetail, ChannelAgent } from '../../api'

// Like an open conversation: new posts from people and agents show within a few seconds.
const POLL_MS = 4_000
const RETRY_MAX_MS = 60_000
const TAIL = 200

type Channel = { detail: AgentConversationDetail; agents: ChannelAgent[] }

/**
 * A channel's messages and agents, polled while it is on screen. One load runs
 * at a time and ticks skip while the window is hidden (sharedPoll); a failed
 * load backs off, and a cheap probe skips the full fetch when nothing changed.
 */
export function useChannel(teamId: string, channelId: string) {
  // A background workspace tab stays mounted but hidden; outside any tab, the pane is on screen.
  const tab = useContext(WorkspaceTabContext)
  const onScreen = tab ? tab.isActive : true
  const key = `channel:${teamId}:${channelId}`
  const state = useRef({
    revision: '',
    last: undefined as Channel | undefined,
    failures: 0,
    retryAt: 0,
  })

  const load = useCallback(async () => {
    const s = state.current

    if (Date.now() < s.retryAt) return s.last
    try {
      const probe = await api.agentGetConversation(channelId, teamId, {
        tail: 1,
        messages: 'omit',
        runtimeState: 'omit',
      })
      const next = `${probe.transcriptUpdatedAt ?? ''}:${String(probe.messageCount)}:${(probe.agentSessionIds ?? []).join(',')}`

      if (next !== s.revision || !s.last) {
        const [detail, listed] = await Promise.all([
          api.agentGetConversation(channelId, teamId, { tail: TAIL, runtimeState: 'omit' }),
          api.agentListChannelAgents(channelId, teamId),
        ])

        s.last = { detail, agents: listed.agents }
        // Only after the full fetch, so a failed one is tried again.
        s.revision = next
      }
      s.failures = 0
      s.retryAt = 0

      return s.last
    } catch (error) {
      s.failures += 1
      s.retryAt = Date.now() + Math.min(RETRY_MAX_MS, POLL_MS * 2 ** s.failures)
      throw error
    }
  }, [teamId, channelId])

  const subscribe = useCallback(
    (listener: () => void) => (onScreen ? subscribePoll(key, load, POLL_MS, listener) : () => {}),
    [onScreen, key, load],
  )
  const channel = useSyncExternalStore(subscribe, () => pollSnapshot<Channel>(key)).value

  // After a post or an agent change: fetch now, even inside a backoff.
  const refresh = useCallback(() => {
    state.current.revision = ''
    state.current.retryAt = 0
    refreshPoll(key)
  }, [key])

  return { detail: channel?.detail ?? null, agents: channel?.agents ?? [], refresh }
}
