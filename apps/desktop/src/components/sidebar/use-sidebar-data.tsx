import { Archive, FileBox } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { api } from '../../api'
import { useAgentRuntimeStates } from '../../lib/agentRuntimeStates'
import { useAgentUnreadSessions } from '../../lib/agentUnreadSessions'
import { onChatUnarchived } from '../../lib/chatArchiveEvents'
import { onChatTitleChanged } from '../../lib/chatTitleEvents'
import { customResourceNavigationKey } from '../../lib/customResourceNavigation'
import { readSwrCache, writeSwrCache } from '../../lib/swrCache'
import { toast } from '../ui/toast'

import { chatSidebarItem } from './chat-item'
import { loadSidebarChats } from './load-sidebar-chats'
import { ARCHIVE_IN_FLIGHT, visibleSidebarChats } from './local-archive-guard'
import {
  AGENT_SESSIONS_POLL_MS,
  agentSessionsCacheKey,
  crdCacheKey,
  resizeDurationMs,
} from './state'

import type { Item, Section } from './types'
import type { AgentConversation } from '../../api'
import type { CustomResourceDefinitionItem, Scope } from '../../types'

// CRDs are discovery metadata: fetch them once per kubeconfig context, then
// expose every served resource kind directly in the cluster nav. Cached
// SWR-style (like the chat list) so returning to a cluster tab paints the
// groups instantly instead of flashing a skeleton. `undefined` means
// "not loaded yet"; `[]` means "loaded, none".
export function useSidebarCrdSections({
  scope,
  kubeconfigContext,
  active,
}: {
  scope: Scope
  kubeconfigContext: string | null
  active: string
}): Section[] {
  const clusterContext = scope.kind === 'cluster' ? kubeconfigContext : null
  const readCachedCrds = (context: string | null) =>
    context ? readSwrCache<CustomResourceDefinitionItem[]>(crdCacheKey(context)) : undefined
  const [customResourceDefinitions, setCustomResourceDefinitions] = useState(() =>
    readCachedCrds(clusterContext),
  )
  // Re-seed on cluster switch during render — same pattern as the team-scoped
  // state, and it keeps the fetch effect free of resetting setState calls.
  const [seededClusterContext, setSeededClusterContext] = useState(clusterContext)

  if (seededClusterContext !== clusterContext) {
    setSeededClusterContext(clusterContext)
    setCustomResourceDefinitions(readCachedCrds(clusterContext))
  }
  useEffect(() => {
    if (!clusterContext) return
    let cancelled = false

    void api
      .listCustomResourceDefinitions(clusterContext)
      .then((definitions) => {
        writeSwrCache(crdCacheKey(clusterContext), definitions)
        if (!cancelled) setCustomResourceDefinitions(definitions)
      })
      .catch(() => {
        // Best-effort discovery — keep whatever is already listed.
        if (!cancelled) setCustomResourceDefinitions((prev) => prev ?? [])
      })

    return () => {
      cancelled = true
    }
  }, [clusterContext])

  return useMemo<Section[]>(() => {
    if (!clusterContext) return []
    if (!customResourceDefinitions) {
      return [{ title: 'Custom resource types', items: [], loading: true }]
    }

    const groups = new Map<string, Item[]>()

    for (const definition of customResourceDefinitions) {
      const version = definition.served_version

      if (!definition.group || !definition.kind || !definition.plural || !version) continue
      const items = groups.get(definition.group) ?? []

      items.push({
        key: customResourceNavigationKey({
          apiVersion: `${definition.group}/${version}`,
          kind: definition.kind,
          plural: definition.plural,
          namespaced: definition.scope === 'Namespaced',
        }),
        label: definition.kind,
        icon: FileBox,
        enabled: true,
      })
      groups.set(definition.group, items)
    }

    return [...groups.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([title, items]) => ({
        title,
        items: items.toSorted((left, right) => left.label.localeCompare(right.label)),
        defaultCollapsed: !items.some((item) => item.key === active),
      }))
  }, [active, clusterContext, customResourceDefinitions])
}

// Agent conversations for the "Chats" section. Cached SWR-style so a
// remount paints instantly; refreshed when the open session changes (a new
// chat needs a beat to be persisted before it lists) and every four seconds so
// runtime execution observations stay fresh. The API returns newest-created first, keeping rows from
// jumping around when an older chat receives another message.
export function useSidebarChats({
  teamId,
  agentSessionId,
  chatShown,
  onArchived,
}: {
  teamId: string
  agentSessionId: string | null
  chatShown: boolean
  /** A chat left the list for the archive — the caller closes any tab showing it. */
  onArchived?: (sessionId: string) => void
}) {
  const [agentSessions, setAgentSessions] = useState<AgentConversation[]>(
    () => readSwrCache<AgentConversation[]>(agentSessionsCacheKey(teamId)) ?? [],
  )
  const [seededTeamId, setSeededTeamId] = useState(teamId)

  if (seededTeamId !== teamId) {
    setSeededTeamId(teamId)
    setAgentSessions(readSwrCache<AgentConversation[]>(agentSessionsCacheKey(teamId)) ?? [])
  }
  // Guards late responses from a previous team after a switch.
  const currentTeamIdRef = useRef(teamId)

  useEffect(() => {
    currentTeamIdRef.current = teamId
  }, [teamId])
  // Rapid archiving races the list refresh: a fetch started before the next
  // archive can respond seconds later still containing that row, and a whole-
  // list setState would resurrect it. Two guards: only the latest request may
  // apply (seq), and rows archived locally stay filtered until a listing
  // requested after the archive landed (see local-archive-guard).
  const refreshSeqRef = useRef(0)
  const refreshingTeamRef = useRef<string | null>(null)
  const locallyArchivedRef = useRef<Map<string, number>>(new Map())
  const refreshSessions = useCallback(async () => {
    // Workspace's loading skeleton intentionally renders the shared Sidebar
    // with an empty team id. Do not start a team-scoped request until the real
    // scope arrives; the backend correctly rejects an empty team id.
    if (!teamId || refreshingTeamRef.current === teamId) return
    refreshingTeamRef.current = teamId
    const seq = ++refreshSeqRef.current

    try {
      const rows = await loadSidebarChats(
        (options) => api.agentListConversations(teamId, options),
        () => currentTeamIdRef.current === teamId && seq === refreshSeqRef.current,
      )

      if (!rows) return
      const conversations = visibleSidebarChats(rows, locallyArchivedRef.current, seq)

      writeSwrCache(agentSessionsCacheKey(teamId), conversations)
      setAgentSessions(conversations)
    } catch {
      // Best-effort list — keep showing whatever we already have.
    } finally {
      if (seq === refreshSeqRef.current) refreshingTeamRef.current = null
    }
  }, [teamId])

  useEffect(() => {
    if (!teamId) return
    // A just-created session needs a beat to be persisted before it lists.
    const initial = setTimeout(() => void refreshSessions(), agentSessionId ? 1000 : 0)
    const interval = setInterval(() => void refreshSessions(), AGENT_SESSIONS_POLL_MS)

    return () => {
      clearTimeout(initial)
      clearInterval(interval)
    }
  }, [refreshSessions, agentSessionId, teamId])

  useEffect(
    () =>
      onChatUnarchived((sessionId) => {
        locallyArchivedRef.current.delete(sessionId)
        void refreshSessions()
      }),
    [refreshSessions],
  )

  const [archivingIds, setArchivingIds] = useState<ReadonlySet<string>>(() => new Set())
  const archiveChat = useCallback(
    async (sessionId: string) => {
      // Re-entrancy guard: a second click while the first archive is in
      // flight would duplicate the PATCH and the refresh.
      if (locallyArchivedRef.current.has(sessionId)) return
      // Collapse the row while the PATCH is in flight; on success remove it
      // for real, on failure flip data-open back so the row visibly expands
      // again — a clear "archive failed" instead of a silent reappear.
      locallyArchivedRef.current.set(sessionId, ARCHIVE_IN_FLIGHT)
      setArchivingIds((prev) => new Set(prev).add(sessionId))
      const collapseDone = new Promise((resolve) => setTimeout(resolve, resizeDurationMs()))
      let ok = false

      try {
        await api.agentSetConversationArchived(sessionId, true, teamId)
        ok = true
      } catch {
        // Handled below once the collapse finished.
      }
      await collapseDone
      if (ok) locallyArchivedRef.current.set(sessionId, refreshSeqRef.current)
      else locallyArchivedRef.current.delete(sessionId)
      setArchivingIds((prev) => {
        const next = new Set(prev)

        next.delete(sessionId)

        return next
      })
      if (ok) {
        setAgentSessions((prev) => prev.filter((c) => c.sessionId !== sessionId))
        onArchived?.(sessionId)
        void refreshSessions()
      } else {
        toast.error('Could not archive chat')
      }
    },
    [teamId, refreshSessions, onArchived],
  )

  useEffect(
    () =>
      onChatTitleChanged((change) => {
        if (change.teamId !== teamId) return
        setAgentSessions((previous) =>
          previous.map((item) =>
            item.sessionId === change.sessionId ? { ...item, title: change.title } : item,
          ),
        )
        void refreshSessions()
      }),
    [teamId, refreshSessions],
  )

  const runtimeStates = useAgentRuntimeStates()
  const unreadSessions = useAgentUnreadSessions()
  const chatItems: Item[] = agentSessions.map((conversation) =>
    chatSidebarItem({
      conversation,
      teamId,
      active: chatShown && agentSessionId === conversation.sessionId,
      runtimeState: runtimeStates.get(conversation.sessionId),
      unread: unreadSessions.has(conversation.sessionId),
      actions: (
        <span
          role="button"
          aria-label="Archive chat"
          title="Archive chat"
          onClick={(e) => {
            e.stopPropagation()
            void archiveChat(conversation.sessionId)
          }}
          className="flex-shrink-0 hidden group-hover:inline-flex items-center justify-center w-5 h-5 rounded text-tertiary hover:text-main hover:bg-[var(--sidebar-overlay-hover)]"
        >
          <Archive className="w-3.5 h-3.5" strokeWidth={1.8} />
        </span>
      ),
    }),
  )
  const newChatActive = chatShown && !agentSessionId

  return { chatItems, newChatActive, archiveChat, archivingIds }
}
