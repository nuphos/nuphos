import { useCallback, useEffect, useRef, useState } from 'react'

import { api } from '../../api'
import { useSilentTick } from '../../hooks/useSilentRefresh'
import { useWorkspaceTab } from '../../hooks/useWorkspaceTab'
import { useResetOnKey } from '../useResetOnKey'

import { PAGE_SIZE } from './memoriesShared'

import type { LoadState, MenuState } from './memoriesShared'
import type { AgentMemoryItem, AgentMemoryScope } from '../../api'

type ListArgs = {
  teamId: string
  refreshKey: number
  onLoading?: (loading: boolean) => void
}

export function useMemoriesList({ teamId, refreshKey, onLoading }: ListArgs) {
  const [scope, setScope] = useState<AgentMemoryScope>('personal')
  const [stateFilter, setStateFilter] = useState<'live' | 'removed'>('live')
  const [state, setState] = useState<LoadState>({ kind: 'loading' })
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selectedMemory, setSelectedMemory] = useState<AgentMemoryItem | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  // One shared removal dialog (menu + detail pane). The optional reason shows
  // in the Removed view and the non-resurrection gate echoes it to the agent.
  const [confirmDelete, setConfirmDelete] = useState<AgentMemoryItem | null>(null)
  const [deleteReason, setDeleteReason] = useState('')
  const listRequestRef = useRef(0)
  const detailRequestRef = useRef(0)

  useResetOnKey(`${scope}|${teamId}|${stateFilter}`, () => {
    setSelectedId(null)
    setSelectedMemory(null)
    setDetailLoading(false)
    setLoadingMore(false)
  })
  useEffect(() => {
    listRequestRef.current += 1
    detailRequestRef.current += 1
  }, [scope, teamId, stateFilter])

  const listState = stateFilter === 'removed' ? ('removed' as const) : undefined

  // reload() is also the recovery path for a failed delete/restore, so entering
  // the loading state belongs to each caller rather than to reload itself.
  const reload = useCallback(() => {
    const requestId = listRequestRef.current + 1

    listRequestRef.current = requestId
    onLoading?.(true)

    return api
      .agentListMemories(undefined, PAGE_SIZE, teamId, scope, listState)
      .then((page) => {
        if (listRequestRef.current !== requestId) return
        setState({
          kind: 'ready',
          enabled: page.enabled,
          memories: page.memories,
          nextCursor: page.nextCursor,
          hasMore: page.hasMore,
        })
        setSelectedId((current) =>
          current && page.memories.some((memory) => memory.id === current) ? current : null,
        )
        setSelectedMemory((current) =>
          current && page.memories.some((memory) => memory.id === current.id) ? current : null,
        )
      })
      .catch((err: unknown) => {
        if (listRequestRef.current !== requestId) return
        setState({ kind: 'error', message: err instanceof Error ? err.message : String(err) })
      })
      .finally(() => {
        if (listRequestRef.current === requestId) {
          onLoading?.(false)
        }
      })
  }, [onLoading, scope, teamId, listState])

  useResetOnKey(`${teamId}|${scope}|${listState ?? ''}|${String(refreshKey)}`, () =>
    setState({ kind: 'loading' }),
  )
  useEffect(() => {
    void reload()
  }, [reload, refreshKey])

  const { pollTick, isActive } = useWorkspaceTab()
  const silentRefresh = useCallback(async () => {
    if (state.kind !== 'ready') return
    if (loadingMore) return
    if (state.memories.length > PAGE_SIZE) return
    const requestId = listRequestRef.current + 1

    listRequestRef.current = requestId
    try {
      const page = await api.agentListMemories(undefined, PAGE_SIZE, teamId, scope, listState)

      if (listRequestRef.current !== requestId) return
      setState({
        kind: 'ready',
        enabled: page.enabled,
        memories: page.memories,
        nextCursor: page.nextCursor,
        hasMore: page.hasMore,
      })
    } catch {
      // Swallow — the next foreground load will surface the error.
    }
  }, [loadingMore, scope, state, teamId, listState])

  useSilentTick(() => {
    void silentRefresh()
  }, pollTick)

  return {
    scope,
    setScope,
    stateFilter,
    setStateFilter,
    state,
    setState,
    selectedId,
    setSelectedId,
    selectedMemory,
    setSelectedMemory,
    detailLoading,
    setDetailLoading,
    menu,
    setMenu,
    loadingMore,
    setLoadingMore,
    confirmDelete,
    setConfirmDelete,
    deleteReason,
    setDeleteReason,
    listRequestRef,
    detailRequestRef,
    listState,
    reload,
    isActive,
  }
}
