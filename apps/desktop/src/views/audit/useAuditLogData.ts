import { useInfiniteQuery } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { api } from '../../api'
import { toast } from '../../components/ui/toast'
import { t } from '../../i18n/index.ts'
import { queryKeys } from '../../lib/query/keys'
import { useRefreshKey, useTabPollMs } from '../../lib/query/tabQuery'

import { isRuntimeImageAuditEvent, isSkillAuditEvent, rangeFrom, userLabel } from './shared'

import type { ConversationsState, EventsState, Range, Scope, Tab } from './shared'
import type { AgentAuditConversationsPage, AgentAuditEventsPage } from '../../api'

type Args = {
  scope: Scope
  tab: Tab
  teamId: string
  mutationsOnly: boolean
  range: Range
  refreshKey: number
  /** Lowercased search text — filters loaded rows client-side. */
  needle: string
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
  onCount,
  onLoading,
}: Args) {
  const [exporting, setExporting] = useState(false)
  const pollMs = useTabPollMs()
  // `from` is computed at each request, so a rolling range like the last 24 h moves with time
  // alike for the polled list and the export.
  const baseArgs = useMemo(
    () => ({ scope, teamId, mutationsOnly: mutationsOnly || undefined }),
    [scope, teamId, mutationsOnly],
  )
  const filters = [scope, range, mutationsOnly] as const
  // Paged past page one, a poll would read every page again: only the first page polls.
  const paged = {
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last: { nextCursor: string | null }) => last.nextCursor ?? undefined,
    refetchInterval: (query: { state: { data?: { pages: unknown[] } } }) =>
      (query.state.data?.pages.length ?? 0) > 1 ? false : pollMs,
  }
  const conversationPages = useInfiniteQuery({
    queryKey: queryKeys.audit(teamId, 'conversations', ...filters),
    queryFn: ({ pageParam }) =>
      api.agentListJournalConversations({ ...baseArgs, from: rangeFrom(range), cursor: pageParam }),
    enabled: tab === 'conversations',
    ...paged,
  })
  const eventPages = useInfiniteQuery({
    queryKey: queryKeys.audit(teamId, 'events', ...filters),
    queryFn: ({ pageParam }) =>
      api.agentListJournalEvents({ ...baseArgs, from: rangeFrom(range), cursor: pageParam }),
    enabled: tab === 'events',
    ...paged,
  })
  const active = tab === 'conversations' ? conversationPages : eventPages
  const conversations = useMemo(
    () => conversationsState(conversationPages),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- derived from these alone
    [conversationPages.data, conversationPages.error],
  )
  const events = useMemo(
    () => eventsState(eventPages),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- derived from these alone
    [eventPages.data, eventPages.error],
  )
  const count =
    tab === 'conversations'
      ? conversations.kind === 'ready' && conversations.rows.length
      : events.kind === 'ready' && events.events.length

  useRefreshKey(active, refreshKey, onLoading)
  useEffect(() => {
    if (count !== false) onCount?.(count)
  }, [count, onCount])
  useEffect(() => {
    if (active.error && !active.data) toast.apiError(t('Failed to load audit log'), active.error)
  }, [active.error, active.data])

  const loadMore = useCallback(async () => {
    const result = await active.fetchNextPage()

    if (result.isError) toast.apiError(t('Failed to load more'), result.error)
  }, [active])
  const loadingMore = active.isFetchingNextPage

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
          from: rangeFrom(range),
          sessionIds: sessionIds && sessionIds.length > 0 ? sessionIds : undefined,
        })

        if (!result.saved) return
        toast.success(
          t('Compliance export saved'),
          t('{sessions} sessions · {events} events', {
            sessions: result.sessionCount,
            events: result.eventCount,
          }),
        )
      } catch (err) {
        toast.apiError(t('Compliance export failed'), err)
      } finally {
        setExporting(false)
      }
    },
    [baseArgs, range, exporting],
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

type Pages<T> = { data?: { pages: T[] }; error: Error | null }

function conversationsState({
  data,
  error,
}: Pages<AgentAuditConversationsPage>): ConversationsState {
  if (!data) return error ? { kind: 'error', message: error.message } : { kind: 'loading' }

  return {
    kind: 'ready',
    rows: data.pages.flatMap((page) => page.conversations),
    users: merged(data.pages.map((page) => page.users)),
    nextCursor: data.pages.at(-1)?.nextCursor ?? null,
  }
}

function eventsState({ data, error }: Pages<AgentAuditEventsPage>): EventsState {
  if (!data) return error ? { kind: 'error', message: error.message } : { kind: 'loading' }

  return {
    kind: 'ready',
    events: data.pages.flatMap((page) => page.events),
    conversations: merged(data.pages.map((page) => page.conversations)),
    users: merged(data.pages.map((page) => page.users)),
    nextCursor: data.pages.at(-1)?.nextCursor ?? null,
  }
}

const merged = <T>(maps: Record<string, T>[]): Record<string, T> =>
  Object.fromEntries(maps.flatMap((map) => Object.entries(map)))
