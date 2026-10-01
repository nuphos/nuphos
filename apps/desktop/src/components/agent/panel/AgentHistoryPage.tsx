import clsx from 'clsx'
import { useCallback, useEffect, useRef, useState } from 'react'

import { api } from '../../../api'
import { onChatTitleChanged } from '../../../lib/chatTitleEvents'
import { toast } from '../../ui/toast'

import { useDebouncedValue, useEventCallbackRef, useSentinelAutoLoad } from './historyPageHooks'
import { useHistoryKeyboardNavigation } from './historyPageKeyboard'
import { HistoryPageList } from './historyPageList'

import type { AgentConversation } from '../../../api'

export const HISTORY_PAGE_SIZE = 30
// A menu, not a page: enough to recognise what you were doing, with search for
// everything past that.

/**
 * Full conversation history, reached via "More" under the Recent list.
 * Search is server-backed (title / first message substring) and debounced;
 * pagination is cursor-based, auto-loading as the sentinel row scrolls into
 * view. The component stays mounted behind the page slide, so fetches are
 * gated on `visible` — each entry into the page refreshes the list.
 */
/**
 * The full conversation history — search, Mine/Team scope, infinite list. Also
 * mounted standalone by the Chats workspace page, which is why it is exported.
 */
export function AgentHistoryPage({
  teamId,
  refreshKey = 0,
  query,
  openingSessionId,
  selectedSessionId = null,
  layout = 'page',
  onOpenConversation,
  historyScope,
  ownerId = null,
  triggerIds = null,
  onListLoaded,
  keyboardNavigation = false,
}: {
  teamId: string
  /** Bumped by the toolbar's refresh button; re-runs the listing. */
  refreshKey?: number
  /** Search text, owned by the workspace Toolbar's shared search box. */
  query: string
  openingSessionId: string | null
  /** Reader layout: the conversation currently open beside the list. */
  selectedSessionId?: string | null
  /**
   * `page` centres the list in a reading column, the way a standalone page
   * should. `rail` is the Chats reader's left column: full-bleed and narrow,
   * where a centred 820px column would leave the rows floating.
   */
  layout?: 'page' | 'rail'
  onOpenConversation: (sessionId: string, titleHint?: string, newTab?: boolean) => void
  historyScope: 'mine' | 'team'
  /** Narrow team scope to a single member's conversations. */
  ownerId?: string | null
  /**
   * List one Trigger's runs (or a Watch group's partition triggers together)
   * instead of Chats. Not a narrowing of the default list — the two are
   * disjoint: Chats excludes trigger runs, and this shows only them.
   */
  triggerIds?: string[] | null
  /**
   * The first page of a list-replacing fetch, so a reader beside this list can
   * open something without waiting to be told. Not fired for load-more: those
   * append below what the reader already chose.
   */
  onListLoaded?: (items: AgentConversation[]) => void
  /** Let Up/Down walk the list. Off for a background tab, whose rows would
   *  otherwise race the visible page for the same keystrokes. */
  keyboardNavigation?: boolean
}) {
  const [items, setItems] = useState<AgentConversation[]>([])
  const [titleRevision, setTitleRevision] = useState(0)

  useEffect(
    () =>
      onChatTitleChanged((change) => {
        if (change.teamId !== teamId) return
        setItems((previous) =>
          previous.map((item) =>
            item.sessionId === change.sessionId ? { ...item, title: change.title } : item,
          ),
        )
        setTitleRevision((value) => value + 1)
      }),
    [teamId],
  )
  const debouncedQuery = useDebouncedValue(query, 250)
  // The cursor carries the requestId of the fetch that produced it, so a
  // load-more can tell when a replacing fetch (new search / scope) has started
  // since — pairing them closes the race where a stale cursor's results get
  // appended to a fresher list.
  const [nextPage, setNextPage] = useState<{ cursor: string; requestId: number } | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  // Bumped on every list-replacing fetch; responses that don't match the
  // latest id are dropped instead of clobbering a newer list.
  const requestIdRef = useRef(0)
  const onListLoadedRef = useEventCallbackRef(onListLoaded)
  const loadMoreInFlightRef = useRef(false)

  // Every new query starts in the loading state; adjusting during render keeps
  // the previous query's rows from lingering as if they answered this one.
  const triggerKey = triggerIds ? triggerIds.join(',') : ''
  const listKey = `${teamId}|${historyScope}|${ownerId ?? ''}|${triggerKey}|${debouncedQuery}`
  const [loadingListKey, setLoadingListKey] = useState(listKey)

  if (listKey !== loadingListKey) {
    setLoadingListKey(listKey)
    setLoading(true)
  }

  // A Trigger's run list is history and keeps every run; only Chats hides
  // what the owner (or the idle sweep) has archived.
  useEffect(() => {
    const requestId = ++requestIdRef.current

    void api
      .agentListConversations(teamId, {
        limit: HISTORY_PAGE_SIZE,
        scope: historyScope,
        archived: triggerIds ? undefined : 'exclude',
        ownerId: ownerId ?? undefined,
        triggerIds: triggerIds ?? undefined,
        search: debouncedQuery || undefined,
      })
      .then((page) => {
        if (requestIdRef.current !== requestId) return
        setItems(page.conversations)
        setNextPage(page.hasMore && page.nextCursor ? { cursor: page.nextCursor, requestId } : null)
        onListLoadedRef.current?.(page.conversations)
      })
      .catch((err: unknown) => {
        if (requestIdRef.current !== requestId) return
        toast.apiError('Failed to load conversation history', err)
      })
      .finally(() => {
        if (requestIdRef.current === requestId) setLoading(false)
      })
    // triggerKey stands in for the triggerIds array, whose identity changes on
    // every render of the caller.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamId, historyScope, ownerId, triggerKey, debouncedQuery, refreshKey, titleRevision])

  const loadMore = useCallback(async () => {
    // A requestId mismatch means a replacing fetch started after this cursor
    // was produced — its list is (or is about to be) gone; don't append.
    if (nextPage?.requestId !== requestIdRef.current) return
    if (loadMoreInFlightRef.current) return
    loadMoreInFlightRef.current = true
    const requestId = nextPage.requestId

    setLoadingMore(true)
    try {
      const page = await api.agentListConversations(teamId, {
        cursor: nextPage.cursor,
        limit: HISTORY_PAGE_SIZE,
        scope: historyScope,
        archived: triggerIds ? undefined : 'exclude',
        ownerId: ownerId ?? undefined,
        triggerIds: triggerIds ?? undefined,
        search: debouncedQuery || undefined,
      })

      if (requestIdRef.current !== requestId) return
      setItems((prev) => {
        // The cursor is a lastActiveAt timestamp, so a conversation that got
        // active between pages can reappear — dedup by sessionId.
        const seen = new Set(prev.map((c) => c.sessionId))

        return [...prev, ...page.conversations.filter((c) => !seen.has(c.sessionId))]
      })
      setNextPage(page.hasMore && page.nextCursor ? { cursor: page.nextCursor, requestId } : null)
    } catch (err) {
      if (requestIdRef.current === requestId) {
        toast.apiError('Failed to load more conversations', err)
      }
    } finally {
      loadMoreInFlightRef.current = false
      setLoadingMore(false)
    }
    // See the listing effect above: triggerKey stands in for triggerIds.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nextPage, teamId, historyScope, ownerId, triggerKey, debouncedQuery])

  // Archive is owner-only on the backend, so the list only offers it on the
  // caller's own rows (see HistoryPageList). The list excludes archived
  // conversations, so the row leaves at once; Undo restores it and puts it
  // back where it was rather than waiting for the next listing.
  async function archiveConversation(conversation: AgentConversation) {
    const label = conversation.title || conversation.firstMessage || 'Untitled chat'

    try {
      await api.agentSetConversationArchived(conversation.sessionId, true, teamId)
    } catch (err) {
      toast.apiError('Could not archive chat', err)

      return
    }
    let index = 0

    setItems((prev) => {
      index = Math.max(
        0,
        prev.findIndex((c) => c.sessionId === conversation.sessionId),
      )

      return prev.filter((c) => c.sessionId !== conversation.sessionId)
    })
    toast.success('Chat archived', `"${label}" is still available in the Agent history.`, {
      action: {
        label: 'Undo',
        onClick: () => {
          void api
            .agentSetConversationArchived(conversation.sessionId, false, teamId)
            .then(() => setItems((prev) => prev.toSpliced(index, 0, conversation)))
            .catch((err: unknown) => toast.apiError('Could not restore chat', err))
        },
      },
    })
  }

  const selectedRowRef = useHistoryKeyboardNavigation({
    keyboardNavigation,
    items,
    selectedSessionId,
    onOpenConversation,
  })

  const { scrollRef, sentinelRef } = useSentinelAutoLoad(nextPage !== null, loadMore)

  return (
    <div className="flex-1 min-h-0 overflow-hidden selectable">
      {/* The scroller is the full-width pane, not the reading column: a
          scrollbar belongs on the edge of the thing being scrolled, and hanging
          it off the centred column left it floating mid-pane. No bottom
          padding either — the list should run under the edge rather than stop
          short and clip its last row above a band of empty space. */}
      <div
        ref={scrollRef}
        className={clsx(
          'h-full min-h-0 overflow-y-auto overflow-x-hidden scrollbar-thin',
          layout === 'rail' ? 'px-2 pt-2' : 'px-6 pt-4',
        )}
      >
        <div className={clsx('w-full', layout === 'page' && 'mx-auto max-w-[820px]')}>
          <div
            className={clsx(
              'transition-all duration-150',
              // The dotted rule is a page-list flourish; in the rail it just
              // draws a stray line above the first row.
              layout === 'page' && 'sketch-line-h pt-px',
              // Same treatment as the Recent list — dim + blur the stale
              // rows while a replacing fetch is in flight.
              loading && items.length > 0 && 'opacity-50 blur-[1.5px] pointer-events-none',
            )}
          >
            <HistoryPageList
              items={items}
              loading={loading}
              debouncedQuery={debouncedQuery}
              ownerId={ownerId}
              historyScope={historyScope}
              teamId={teamId}
              openingSessionId={openingSessionId}
              selectedSessionId={selectedSessionId}
              layout={layout}
              selectedRowRef={selectedRowRef}
              hasMore={nextPage !== null}
              sentinelRef={sentinelRef}
              loadingMore={loadingMore}
              loadMore={loadMore}
              emptyLabel={triggerIds ? "This trigger hasn't run yet." : undefined}
              onOpenConversation={onOpenConversation}
              onArchive={archiveConversation}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
