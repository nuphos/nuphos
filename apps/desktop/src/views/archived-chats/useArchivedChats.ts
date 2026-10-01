import { useCallback, useEffect, useRef, useState } from 'react'

import { api } from '../../api'
import { useDebouncedValue } from '../../components/agent/panel/historyPageHooks'
import { toast } from '../../components/ui/toast'
import { announceChatUnarchived } from '../../lib/chatArchiveEvents'

import { appendArchivedPage } from './archivedChatsList'

import type { AgentConversation } from '../../api'

const PAGE_SIZE = 30

function chatLabel(conversation: AgentConversation): string {
  return conversation.title || conversation.firstMessage || 'Untitled chat'
}

export function useArchivedChats({
  teamId,
  filter,
  refreshKey,
  onLoading,
}: {
  teamId: string
  filter: string
  refreshKey: number
  onLoading?: (loading: boolean) => void
}) {
  const search = useDebouncedValue(filter, 250)
  const [items, setItems] = useState<AgentConversation[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [restoringIds, setRestoringIds] = useState<ReadonlySet<string>>(() => new Set())
  const requestIdRef = useRef(0)

  const readPage = useCallback(
    (pageCursor?: string) =>
      api.agentListConversations(teamId, {
        scope: 'mine',
        sort: 'archived',
        limit: PAGE_SIZE,
        search: search || undefined,
        ...(pageCursor ? { cursor: pageCursor } : {}),
      }),
    [teamId, search],
  )

  const listKey = `${teamId}|${search}|${String(refreshKey)}`
  const [loadingListKey, setLoadingListKey] = useState(listKey)

  if (listKey !== loadingListKey) {
    setLoadingListKey(listKey)
    setLoading(true)
  }

  useEffect(() => {
    const requestId = ++requestIdRef.current

    onLoading?.(true)
    readPage()
      .then((page) => {
        if (requestIdRef.current !== requestId) return
        setItems(page.conversations)
        setCursor(page.hasMore ? page.nextCursor : null)
      })
      .catch((err: unknown) => {
        if (requestIdRef.current === requestId) toast.apiError('Could not load archived chats', err)
      })
      .finally(() => {
        if (requestIdRef.current !== requestId) return
        setLoading(false)
        onLoading?.(false)
      })
    // onLoading is the page shell's setter; its identity is not a reason to refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readPage, refreshKey])

  const loadMore = useCallback(async () => {
    if (!cursor || loadingMore) return
    const requestId = requestIdRef.current

    setLoadingMore(true)
    try {
      const page = await readPage(cursor)

      if (requestIdRef.current !== requestId) return
      setItems((prev) => appendArchivedPage(prev, page.conversations))
      setCursor(page.hasMore ? page.nextCursor : null)
    } catch (err) {
      if (requestIdRef.current === requestId) toast.apiError('Could not load archived chats', err)
    } finally {
      setLoadingMore(false)
    }
  }, [cursor, loadingMore, readPage])

  const unarchive = useCallback(
    async (conversation: AgentConversation) => {
      const { sessionId } = conversation

      if (restoringIds.has(sessionId)) return
      setRestoringIds((prev) => new Set(prev).add(sessionId))
      try {
        await api.agentSetConversationArchived(sessionId, false, teamId)
        setItems((prev) => prev.filter((c) => c.sessionId !== sessionId))
        announceChatUnarchived(sessionId)
        toast.success('Chat unarchived', `"${chatLabel(conversation)}" is back in Chats.`)
      } catch (err) {
        toast.apiError('Could not unarchive chat', err)
      } finally {
        setRestoringIds((prev) => {
          const next = new Set(prev)

          next.delete(sessionId)

          return next
        })
      }
    },
    [restoringIds, teamId],
  )

  return {
    items,
    loading,
    loadingMore,
    hasMore: cursor !== null,
    search,
    restoringIds,
    loadMore,
    unarchive,
  }
}
