import { RotateCcw, Trash2 } from 'lucide-react'
import { useCallback } from 'react'

import { api } from '../../api'
import { toast } from '../../components/ui/toast'

import { PAGE_SIZE } from './memoriesShared'

import type { LoadState } from './memoriesShared'
import type { AgentMemoryItem, AgentMemoryScope } from '../../api'
import type { ContextMenuItem } from '../../components/ContextMenu'
import type { RefObject } from 'react'

type ActionsArgs = {
  teamId: string
  scope: AgentMemoryScope
  stateFilter: 'live' | 'removed'
  listState: 'removed' | undefined
  state: LoadState
  setState: React.Dispatch<React.SetStateAction<LoadState>>
  selectedId: string | null
  setSelectedId: React.Dispatch<React.SetStateAction<string | null>>
  setSelectedMemory: React.Dispatch<React.SetStateAction<AgentMemoryItem | null>>
  setDetailLoading: React.Dispatch<React.SetStateAction<boolean>>
  setConfirmDelete: React.Dispatch<React.SetStateAction<AgentMemoryItem | null>>
  loadingMore: boolean
  setLoadingMore: React.Dispatch<React.SetStateAction<boolean>>
  listRequestRef: RefObject<number>
  detailRequestRef: RefObject<number>
  reload: () => Promise<void>
}

export function useMemoryActions(args: ActionsArgs) {
  const {
    teamId,
    scope,
    stateFilter,
    listState,
    state,
    setState,
    selectedId,
    setSelectedId,
    setSelectedMemory,
    setDetailLoading,
    setConfirmDelete,
    loadingMore,
    setLoadingMore,
    listRequestRef,
    detailRequestRef,
    reload,
  } = args
  const openMemory = useCallback(
    async (memory: AgentMemoryItem) => {
      const requestId = detailRequestRef.current + 1

      detailRequestRef.current = requestId
      setSelectedId(memory.id)
      setSelectedMemory(memory)
      setDetailLoading(true)
      try {
        const fresh = await api.agentGetMemory(memory.id, teamId, scope)

        if (detailRequestRef.current === requestId) {
          setSelectedMemory(fresh)
        }
      } catch (err) {
        console.warn('[memory] failed to load detail', err)
      } finally {
        if (detailRequestRef.current === requestId) {
          setDetailLoading(false)
        }
      }
    },
    [scope, teamId, detailRequestRef, setDetailLoading, setSelectedId, setSelectedMemory],
  )

  const deleteMemory = useCallback(
    async (memory: AgentMemoryItem, reason?: string) => {
      try {
        await api.agentDeleteMemory(memory.id, teamId, scope, reason)
        setState((prev) => {
          if (prev.kind !== 'ready') return prev

          return {
            ...prev,
            memories: prev.memories.filter((item) => item.id !== memory.id),
          }
        })
        if (selectedId === memory.id) {
          setSelectedId(null)
          setSelectedMemory(null)
        }
      } catch (err) {
        console.warn('[memory] failed to delete memory', err)
        toast.apiError('Could not remove memory', err)
        setState({ kind: 'loading' })
        void reload()
      }
    },
    [reload, scope, selectedId, teamId, setSelectedId, setSelectedMemory, setState],
  )

  const restoreMemory = useCallback(
    async (memory: AgentMemoryItem) => {
      try {
        await api.agentRestoreMemory(memory.id, teamId, scope)
        setState((prev) => {
          if (prev.kind !== 'ready') return prev

          return {
            ...prev,
            memories: prev.memories.filter((item) => item.id !== memory.id),
          }
        })
        if (selectedId === memory.id) {
          setSelectedId(null)
          setSelectedMemory(null)
        }
      } catch (err) {
        console.warn('[memory] failed to restore memory', err)
        toast.apiError('Could not restore memory', err)
        setState({ kind: 'loading' })
        void reload()
      }
    },
    [reload, scope, selectedId, teamId, setSelectedId, setSelectedMemory, setState],
  )

  const buildMenu = useCallback(
    (memory: AgentMemoryItem): ContextMenuItem[] =>
      stateFilter === 'removed'
        ? [
            {
              key: 'restore',
              label: 'Restore memory',
              icon: RotateCcw,
              onSelect: () => void restoreMemory(memory),
            },
          ]
        : [
            {
              key: 'delete',
              label: 'Remove memory',
              icon: Trash2,
              destructive: true,
              onSelect: () => setConfirmDelete(memory),
            },
          ],
    [restoreMemory, stateFilter, setConfirmDelete],
  )

  const loadMore = useCallback(async () => {
    if (state.kind !== 'ready' || !state.nextCursor || loadingMore) return
    const cursor = state.nextCursor
    const requestId = listRequestRef.current + 1

    listRequestRef.current = requestId
    setLoadingMore(true)
    try {
      const page = await api.agentListMemories(cursor, PAGE_SIZE, teamId, scope, listState)

      if (listRequestRef.current !== requestId) return
      setState((prev) => {
        if (prev.kind !== 'ready') return prev
        if (prev.nextCursor !== cursor) return prev

        return {
          kind: 'ready',
          enabled: page.enabled,
          memories: [...prev.memories, ...page.memories],
          nextCursor: page.nextCursor,
          hasMore: page.hasMore,
        }
      })
    } catch (err) {
      if (listRequestRef.current !== requestId) return
      setState({ kind: 'error', message: err instanceof Error ? err.message : String(err) })
    } finally {
      if (listRequestRef.current === requestId) {
        setLoadingMore(false)
      }
    }
  }, [loadingMore, scope, state, teamId, listState, listRequestRef, setLoadingMore, setState])

  return { openMemory, deleteMemory, restoreMemory, buildMenu, loadMore }
}
