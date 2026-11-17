import { useQueryClient } from '@tanstack/react-query'
import { FileBox } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { api } from '../../api'
import { t } from '../../i18n'
import { agentAvatarPick } from '../../lib/agentAvatarChoices'
import { archiveChat as archiveChatRequest } from '../../lib/archiveChat'
import { announceChatArchived } from '../../lib/chatArchiveEvents'
import { onChatTitleChanged } from '../../lib/chatTitleEvents'
import { customResourceNavigationKey } from '../../lib/customResourceNavigation'
import { cssDurationMs } from '../../lib/motion'
import { queryKeys } from '../../lib/query/keys'
import { readSwrCache, writeSwrCache } from '../../lib/swrCache'
import { toast } from '../ui/toast'

import { removeChat, retitleChat, useAgentSessions } from './agentSessions'
import { crdCacheKey } from './state'
import { useChatItems } from './use-chat-items'
import { useSidebarArchiveEvents } from './use-sidebar-archive-events'
import { useBotArchiveFocus } from './useBotArchiveFocus'

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
      return [{ title: t('Custom resource types'), items: [], loading: true }]
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

// Agent conversations for the "Chats" section, from the shared listing every Chats reader polls.
// A just-opened session needs a beat to be persisted before it lists, so opening one lists again.
export function useSidebarChats({
  teamId,
  agentSessionId,
  chatShown,
  onArchived,
  onBotArchiveSelect,
}: {
  teamId: string
  agentSessionId: string | null
  chatShown: boolean
  /** A chat left the list for the archive — the caller closes any tab showing it. */
  onArchived?: (sessionId: string) => void
  onBotArchiveSelect?: (key: string) => void
}) {
  const client = useQueryClient()
  const agentSessions = useAgentSessions(teamId).data ?? NONE
  const refresh = useCallback(
    () => void client.invalidateQueries({ queryKey: queryKeys.agentSessions(teamId) }),
    [client, teamId],
  )

  useEffect(() => {
    if (!agentSessionId) return
    const later = setTimeout(refresh, 1000)

    return () => clearTimeout(later)
  }, [refresh, agentSessionId])

  const [archivingIds, setArchivingIds] = useState<ReadonlySet<string>>(() => new Set())
  const archiving = useRef(new Set<string>())
  const chatItems = useChatItems({ agentSessions, teamId, chatShown, agentSessionId })
  const handleArchived = useBotArchiveFocus(() => ({
    teamId,
    selectedId: agentSessionId,
    enabled: Boolean(onBotArchiveSelect),
    onArchived,
    onSelect: (key) => onBotArchiveSelect?.(key),
    items: chatItems,
    archiving: archivingIds,
  }))
  const { offerUndo } = useSidebarArchiveEvents({
    teamId,
    sessions: agentSessions,
    onArchived: handleArchived,
  })
  const archiveChat = useCallback(
    async (sessionId: string) => {
      // Re-entrancy guard: a second click while the first archive is in
      // flight would duplicate the PATCH and the refresh.
      if (archiving.current.has(sessionId)) return
      archiving.current.add(sessionId)
      // Collapse the row while the PATCH is in flight; on success remove it
      // for real, on failure the row visibly expands again — a clear
      // "archive failed" instead of a silent reappear.
      setArchivingIds((prev) => new Set(prev).add(sessionId))
      const collapseDone = new Promise((resolve) =>
        setTimeout(resolve, cssDurationMs('--resize-dur', 300)),
      )
      let ok = false
      let botSessionId: string | undefined

      try {
        ;({ botSessionId } = await archiveChatRequest(sessionId, teamId))
        ok = true
      } catch {
        // Handled below once the collapse finished.
      }
      await collapseDone
      if (ok) await removeChat(client, teamId, sessionId)
      archiving.current.delete(sessionId)
      setArchivingIds((prev) => {
        const next = new Set(prev)

        next.delete(sessionId)

        return next
      })
      if (ok) {
        announceChatArchived({ sessionId, teamId })
        offerUndo(sessionId, botSessionId)
      } else {
        toast.error(
          agentAvatarPick(sessionId) ? t('Could not archive Bot') : t('Could not archive task'),
        )
      }
    },
    [client, teamId, offerUndo],
  )

  const unlinkChat = useCallback(
    async (sessionId: string) => {
      try {
        await api.agentUnlinkConversationParent(sessionId, teamId)
        refresh()
      } catch (err) {
        toast.apiError(t('Could not unlink agent'), err)
      }
    },
    [teamId, refresh],
  )

  useEffect(
    () =>
      onChatTitleChanged((change) => {
        if (change.teamId === teamId)
          void retitleChat(client, teamId, change.sessionId, change.title)
      }),
    [client, teamId],
  )

  const newChatActive = chatShown && !agentSessionId

  return { agentSessions, chatItems, newChatActive, archiveChat, unlinkChat, archivingIds }
}

const NONE: AgentConversation[] = []
