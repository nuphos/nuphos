import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useRef, useState } from 'react'

import { api } from '../../api'
import { useWorkspaceTab } from '../../hooks/useWorkspaceTab'
import { queryKeys } from '../../lib/query/keys'
import { useRefreshKey, useTabPollMs } from '../../lib/query/tabQuery'
import { useResetOnKey } from '../useResetOnKey'

import { PAGE_SIZE } from './memoriesShared'

import type { LoadState, MenuState } from './memoriesShared'
import type { AgentMemoryPage, AgentMemoryItem, AgentMemoryScope } from '../../api'
import type { InfiniteData } from '@tanstack/react-query'

type ListArgs = {
  teamId: string
  refreshKey: number
  onLoading?: (loading: boolean) => void
}

export function useMemoriesList({ teamId, refreshKey, onLoading }: ListArgs) {
  const [scope, setScope] = useState<AgentMemoryScope>('personal')
  const [stateFilter, setStateFilter] = useState<'live' | 'removed'>('live')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selectedMemory, setSelectedMemory] = useState<AgentMemoryItem | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [menu, setMenu] = useState<MenuState | null>(null)
  // One shared removal dialog (menu + detail pane). The optional reason shows
  // in the Removed view and the non-resurrection gate echoes it to the agent.
  const [confirmDelete, setConfirmDelete] = useState<AgentMemoryItem | null>(null)
  const [deleteReason, setDeleteReason] = useState('')
  const detailRequestRef = useRef(0)

  useResetOnKey(`${scope}|${teamId}|${stateFilter}`, () => {
    setSelectedId(null)
    setSelectedMemory(null)
    setDetailLoading(false)
  })
  useEffect(() => {
    detailRequestRef.current += 1
  }, [scope, teamId, stateFilter])

  const listState = stateFilter === 'removed' ? ('removed' as const) : undefined
  const client = useQueryClient()
  const queryKey = queryKeys.memories(teamId, scope, stateFilter)
  const pollMs = useTabPollMs()
  const pages = useInfiniteQuery({
    queryKey,
    queryFn: ({ pageParam }) =>
      api.agentListMemories(pageParam, PAGE_SIZE, teamId, scope, listState),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => (last.hasMore ? (last.nextCursor ?? undefined) : undefined),
    // Paged past page one, a poll would read every page again: only the first page polls.
    refetchInterval: (query) => ((query.state.data?.pages.length ?? 0) > 1 ? false : pollMs),
  })
  const state = loadState(pages)

  useRefreshKey(pages, refreshKey, onLoading)

  /** A memory removed or restored leaves this list at once. */
  const removeFromList = useCallback(
    (id: string) =>
      client.setQueryData<InfiniteData<AgentMemoryPage>>(queryKey, (data) =>
        withoutMemory(data, id),
      ),
    // The key is rebuilt from these on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [client, teamId, scope, stateFilter],
  )
  const { refetch, fetchNextPage } = pages
  const reload = useCallback(async () => {
    await refetch()
  }, [refetch])
  const loadMore = useCallback(async () => {
    await fetchNextPage()
  }, [fetchNextPage])
  const { isActive } = useWorkspaceTab()

  return {
    scope,
    setScope,
    stateFilter,
    setStateFilter,
    state,
    selectedId,
    setSelectedId,
    selectedMemory,
    setSelectedMemory,
    detailLoading,
    setDetailLoading,
    menu,
    setMenu,
    loadingMore: pages.isFetchingNextPage,
    loadMore,
    removeFromList,
    confirmDelete,
    setConfirmDelete,
    deleteReason,
    setDeleteReason,
    detailRequestRef,
    reload,
    isActive,
  }
}

function withoutMemory(data: InfiniteData<AgentMemoryPage> | undefined, id: string) {
  if (!data) return data
  const pages = data.pages.map((page) => ({
    ...page,
    memories: page.memories.filter((memory) => memory.id !== id),
  }))

  return { ...data, pages }
}

function loadState({
  data,
  error,
}: {
  data?: InfiniteData<AgentMemoryPage>
  error: Error | null
}): LoadState {
  if (!data) return error ? { kind: 'error', message: error.message } : { kind: 'loading' }
  const last = data.pages.at(-1)

  return {
    kind: 'ready',
    enabled: data.pages[0]?.enabled ?? false,
    memories: data.pages.flatMap((page) => page.memories),
    nextCursor: last?.nextCursor ?? null,
    hasMore: last?.hasMore ?? false,
  }
}
