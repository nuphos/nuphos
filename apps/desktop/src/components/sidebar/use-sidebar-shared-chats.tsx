import { useCallback, useEffect, useRef, useState } from 'react'

import { api } from '../../api'
import { useAgentRuntimeStates } from '../../lib/agentRuntimeStates'
import { useAgentUnreadSessions } from '../../lib/agentUnreadSessions'
import { readSwrCache, writeSwrCache } from '../../lib/swrCache'

import { chatSidebarItem } from './chat-item'
import { loadSidebarChats } from './load-sidebar-chats'
import { visibleSidebarChats } from './local-archive-guard'
import { AGENT_SESSIONS_POLL_MS, sharedSessionsCacheKey } from './state'
import { useSidebarArchiveEvents } from './use-sidebar-archive-events'

import type { Item } from './types'
import type { AgentConversation } from '../../api'

/**
 * Sessions the viewer joined but does not own — the "Shared" section above
 * Chats. Deliberately thinner than `useSidebarChats`: these rows carry no
 * archive or rename (both are the owner's), so there is no in-flight archive to
 * guard against and the only ordering concern is that a late response from a
 * previous team or request cannot overwrite a newer one.
 *
 * Empty is the common case, and an empty list renders no section at all.
 */
export function useSidebarSharedChats({
  teamId,
  agentSessionId,
  chatShown,
}: {
  teamId: string
  agentSessionId: string | null
  chatShown: boolean
}): { sharedChatItems: Item[] } {
  const [sessions, setSessions] = useState<AgentConversation[]>(
    () => readSwrCache<AgentConversation[]>(sharedSessionsCacheKey(teamId)) ?? [],
  )
  const [seededTeamId, setSeededTeamId] = useState(teamId)

  if (seededTeamId !== teamId) {
    setSeededTeamId(teamId)
    setSessions(readSwrCache<AgentConversation[]>(sharedSessionsCacheKey(teamId)) ?? [])
  }
  const currentTeamIdRef = useRef(teamId)

  useEffect(() => {
    currentTeamIdRef.current = teamId
  }, [teamId])
  const refreshSeqRef = useRef(0)
  const locallyArchivedRef = useRef<Map<string, number>>(new Map())
  const refreshingTeamRef = useRef<string | null>(null)
  const refresh = useCallback(async () => {
    // The workspace's loading skeleton renders the sidebar with an empty team
    // id; a team-scoped listing is correctly rejected until the real one lands.
    if (!teamId || refreshingTeamRef.current === teamId) return
    refreshingTeamRef.current = teamId
    const seq = ++refreshSeqRef.current

    try {
      const rows = await loadSidebarChats(
        (options) => api.agentListConversations(teamId, options),
        () => currentTeamIdRef.current === teamId && seq === refreshSeqRef.current,
        'shared',
      )

      if (!rows) return
      const visible = visibleSidebarChats(rows, locallyArchivedRef.current, seq)

      writeSwrCache(sharedSessionsCacheKey(teamId), visible)
      setSessions(visible)
    } catch {
      // Best-effort list — keep showing whatever is already there.
    } finally {
      if (seq === refreshSeqRef.current) refreshingTeamRef.current = null
    }
  }, [teamId])

  useEffect(() => {
    if (!teamId) return
    void refresh()
    const interval = setInterval(() => void refresh(), AGENT_SESSIONS_POLL_MS)

    return () => clearInterval(interval)
  }, [refresh, teamId])

  useSidebarArchiveEvents({ teamId, locallyArchivedRef, refreshSeqRef, setSessions, refresh })

  const runtimeStates = useAgentRuntimeStates()
  const unreadSessions = useAgentUnreadSessions()
  const sharedChatItems = sessions.map((conversation) =>
    chatSidebarItem({
      conversation,
      teamId,
      active: chatShown && agentSessionId === conversation.sessionId,
      runtimeState: runtimeStates.get(conversation.sessionId),
      unread: unreadSessions.has(conversation.sessionId),
      readOnly: true,
    }),
  )

  return { sharedChatItems }
}
