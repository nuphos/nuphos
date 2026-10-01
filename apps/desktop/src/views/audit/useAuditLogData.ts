import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { api } from '../../api'
import { toast } from '../../components/ui/toast'
import { useSilentTick } from '../../hooks/useSilentRefresh'

import { isRuntimeImageAuditEvent, isSkillAuditEvent, rangeFrom, userLabel } from './shared'

import type { ConversationsState, EventsState, Range, Scope, Tab } from './shared'

type Args = {
  scope: Scope
  tab: Tab
  teamId: string
  mutationsOnly: boolean
  range: Range
  refreshKey: number
  /** Lowercased search text — filters loaded rows client-side. */
  needle: string
  pollTick: number
  onCount?: (n: number) => void
  onLoading?: (loading: boolean) => void
}

export function useAuditLogData({
  scope,
  tab,
  teamId,
  mutationsOnly,
  range,
  refreshKey,
  needle,
  pollTick,
  onCount,
  onLoading,
}: Args) {
  const [conversations, setConversations] = useState<ConversationsState>({ kind: 'loading' })
  const [events, setEvents] = useState<EventsState>({ kind: 'loading' })
  const [loadingMore, setLoadingMore] = useState(false)
  const [exporting, setExporting] = useState(false)
  // Guards against pagination hazards (CodeRabbit review):
  // - generation bumps whenever tab/filters change, so an in-flight load-more
  //   from the previous filter set is discarded instead of appended;
  // - loadedMore suppresses the silent background refresh once the user has
  //   paged past page one (a first-page refetch would discard those pages).
  const genRef = useRef(0)
  const loadedMoreRef = useRef(false)

  const baseArgs = useMemo(
    () => ({
      scope,
      teamId,
      mutationsOnly: mutationsOnly || undefined,
      from: rangeFrom(range),
    }),
    [scope, teamId, mutationsOnly, range],
  )

  // Fetch + apply are split so every setState lives inside a promise callback
  // (react-hooks/set-state-in-effect): the effect body only kicks the fetch.
  const fetchPage = useCallback(() => {
    return tab === 'conversations'
      ? api
          .agentListJournalConversations(baseArgs)
          .then((page) => ({ kind: 'conversations' as const, page }))
      : api.agentListJournalEvents(baseArgs).then((page) => ({ kind: 'events' as const, page }))
  }, [tab, baseArgs])

  const applyPage = useCallback(
    (result: Awaited<ReturnType<typeof fetchPage>>) => {
      if (result.kind === 'conversations') {
        setConversations({
          kind: 'ready',
          rows: result.page.conversations,
          users: result.page.users,
          nextCursor: result.page.nextCursor,
        })
        onCount?.(result.page.conversations.length)
      } else {
        setEvents({
          kind: 'ready',
          events: result.page.events,
          conversations: result.page.conversations,
          users: result.page.users,
          nextCursor: result.page.nextCursor,
        })
        onCount?.(result.page.events.length)
      }
    },
    [onCount],
  )

  useEffect(() => {
    let cancelled = false

    // New filter set: invalidate in-flight load-mores and re-arm the silent
    // refresh (we're back on page one).
    genRef.current += 1
    loadedMoreRef.current = false
    onLoading?.(true)
    fetchPage()
      .then((result) => {
        if (!cancelled) applyPage(result)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        const message = err instanceof Error ? err.message : String(err)

        if (tab === 'conversations') setConversations({ kind: 'error', message })
        else setEvents({ kind: 'error', message })
        toast.apiError('Failed to load audit log', err)
      })
      .finally(() => {
        if (!cancelled) onLoading?.(false)
      })

    return () => {
      cancelled = true
    }
  }, [fetchPage, applyPage, refreshKey, onLoading, tab])

  // Silent background refresh: same fetch, no loading churn, errors swallowed
  // (the next foreground load surfaces them). Skipped while paging or once
  // the user has loaded more — a first-page refetch would discard pages.
  useSilentTick(() => {
    if (loadingMore || loadedMoreRef.current) return
    const gen = genRef.current

    fetchPage()
      .then((result) => {
        if (genRef.current === gen) applyPage(result)
      })
      .catch(() => {})
  }, pollTick)

  const loadMore = useCallback(async () => {
    if (loadingMore) return
    const gen = genRef.current

    setLoadingMore(true)
    try {
      if (tab === 'conversations' && conversations.kind === 'ready' && conversations.nextCursor) {
        const page = await api.agentListJournalConversations({
          ...baseArgs,
          cursor: conversations.nextCursor,
        })

        if (genRef.current !== gen) return // filters changed mid-flight
        loadedMoreRef.current = true
        setConversations({
          kind: 'ready',
          rows: [...conversations.rows, ...page.conversations],
          users: { ...conversations.users, ...page.users },
          nextCursor: page.nextCursor,
        })
        onCount?.(conversations.rows.length + page.conversations.length)
      } else if (tab === 'events' && events.kind === 'ready' && events.nextCursor) {
        const page = await api.agentListJournalEvents({ ...baseArgs, cursor: events.nextCursor })

        if (genRef.current !== gen) return // filters changed mid-flight
        loadedMoreRef.current = true
        setEvents({
          kind: 'ready',
          events: [...events.events, ...page.events],
          conversations: { ...events.conversations, ...page.conversations },
          users: { ...events.users, ...page.users },
          nextCursor: page.nextCursor,
        })
        onCount?.(events.events.length + page.events.length)
      }
    } catch (err) {
      toast.apiError('Failed to load more', err)
    } finally {
      setLoadingMore(false)
    }
  }, [loadingMore, tab, baseArgs, conversations, events, onCount])

  const conversationRows = useMemo(() => {
    if (conversations.kind !== 'ready') return []
    if (!needle) return conversations.rows

    return conversations.rows.filter(
      (row) =>
        row.title.toLowerCase().includes(needle) ||
        row.userIds.some((id) => userLabel(conversations.users, id).toLowerCase().includes(needle)),
    )
  }, [conversations, needle])

  const eventRows = useMemo(() => {
    if (events.kind !== 'ready') return []
    if (!needle) return events.events

    return events.events.filter((event) => {
      if (isSkillAuditEvent(event)) {
        return (
          event.resource.name.toLowerCase().includes(needle) ||
          event.mutation.action.toLowerCase().includes(needle) ||
          event.mutation.source.toLowerCase().includes(needle) ||
          userLabel(events.users, event.actor.userId).toLowerCase().includes(needle)
        )
      }
      if (isRuntimeImageAuditEvent(event)) {
        return (
          event.resource.label.toLowerCase().includes(needle) ||
          event.resource.provider.includes(needle) ||
          event.change.toImage.toLowerCase().includes(needle) ||
          userLabel(events.users, event.actor.userId).toLowerCase().includes(needle)
        )
      }
      const title = events.conversations[event.session.conversationId]?.title ?? ''

      return (
        title.toLowerCase().includes(needle) ||
        userLabel(events.users, event.actor.userId).toLowerCase().includes(needle)
      )
    })
  }, [events, needle])

  // Export the whole filtered scope, or just `sessionIds` when the bulk bar
  // asks for the current selection.
  const exportComplianceRecords = useCallback(
    async (sessionIds?: string[]) => {
      if (exporting) return
      setExporting(true)
      try {
        const result = await api.agentExportJournal({
          ...baseArgs,
          sessionIds: sessionIds && sessionIds.length > 0 ? sessionIds : undefined,
        })

        if (!result.saved) return
        toast.success(
          'Compliance export saved',
          `${String(result.sessionCount)} sessions · ${String(result.eventCount)} events`,
        )
      } catch (err) {
        toast.apiError('Compliance export failed', err)
      } finally {
        setExporting(false)
      }
    },
    [baseArgs, exporting],
  )

  return {
    conversations,
    events,
    conversationRows,
    eventRows,
    loadingMore,
    loadMore,
    exporting,
    exportComplianceRecords,
  }
}
