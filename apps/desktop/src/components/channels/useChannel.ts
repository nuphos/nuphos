import { useCallback, useEffect, useRef, useState } from 'react'

import { api } from '../../api'

import type { AgentConversationDetail, ChannelAgent } from '../../api'

// Like an open conversation: new posts from people and agents show within a few seconds.
const POLL_MS = 4_000
const TAIL = 200

/** A channel's messages and agents, polled while it is open. */
export function useChannel(teamId: string, channelId: string) {
  const [detail, setDetail] = useState<AgentConversationDetail | null>(null)
  const [agents, setAgents] = useState<ChannelAgent[]>([])
  const revision = useRef('')

  const refresh = useCallback(
    async (force = false) => {
      const probe = await api.agentGetConversation(channelId, teamId, {
        tail: 1,
        messages: 'omit',
        runtimeState: 'omit',
      })
      const next = `${probe.transcriptUpdatedAt ?? ''}:${String(probe.messageCount)}:${(probe.agentSessionIds ?? []).join(',')}`

      if (!force && next === revision.current) return
      revision.current = next
      const [full, listed] = await Promise.all([
        api.agentGetConversation(channelId, teamId, { tail: TAIL, runtimeState: 'omit' }),
        api.agentListChannelAgents(channelId, teamId),
      ])

      setDetail(full)
      setAgents(listed.agents)
    },
    [teamId, channelId],
  )

  // The pane is keyed by channel, so a new channel starts from empty state.
  useEffect(() => {
    void refresh(true).catch(() => {})
    const timer = window.setInterval(() => void refresh().catch(() => {}), POLL_MS)

    return () => window.clearInterval(timer)
  }, [refresh])

  return { detail, agents, setAgents, refresh: () => refresh(true) }
}
