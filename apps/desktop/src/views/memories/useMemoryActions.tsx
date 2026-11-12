import { RotateCcw, Trash2 } from 'lucide-react'
import { useCallback } from 'react'

import { api } from '../../api'
import { toast } from '../../components/ui/toast'
import { t } from '../../i18n'

import type { AgentMemoryItem, AgentMemoryScope } from '../../api'
import type { ContextMenuItem } from '../../components/ContextMenu'
import type { RefObject } from 'react'

type ActionsArgs = {
  teamId: string
  scope: AgentMemoryScope
  stateFilter: 'live' | 'removed'
  removeFromList: (id: string) => void
  selectedId: string | null
  setSelectedId: React.Dispatch<React.SetStateAction<string | null>>
  setSelectedMemory: React.Dispatch<React.SetStateAction<AgentMemoryItem | null>>
  setDetailLoading: React.Dispatch<React.SetStateAction<boolean>>
  setConfirmDelete: React.Dispatch<React.SetStateAction<AgentMemoryItem | null>>
  detailRequestRef: RefObject<number>
  reload: () => Promise<void>
}

export function useMemoryActions(args: ActionsArgs) {
  const {
    teamId,
    scope,
    stateFilter,
    removeFromList,
    selectedId,
    setSelectedId,
    setSelectedMemory,
    setDetailLoading,
    setConfirmDelete,
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
        removeFromList(memory.id)
        if (selectedId === memory.id) {
          setSelectedId(null)
          setSelectedMemory(null)
        }
      } catch (err) {
        console.warn('[memory] failed to delete memory', err)
        toast.apiError(t('Could not remove memory'), err)
        void reload()
      }
    },
    [reload, removeFromList, scope, selectedId, teamId, setSelectedId, setSelectedMemory],
  )

  const restoreMemory = useCallback(
    async (memory: AgentMemoryItem) => {
      try {
        await api.agentRestoreMemory(memory.id, teamId, scope)
        removeFromList(memory.id)
        if (selectedId === memory.id) {
          setSelectedId(null)
          setSelectedMemory(null)
        }
      } catch (err) {
        console.warn('[memory] failed to restore memory', err)
        toast.apiError(t('Could not restore memory'), err)
        void reload()
      }
    },
    [reload, removeFromList, scope, selectedId, teamId, setSelectedId, setSelectedMemory],
  )

  const buildMenu = useCallback(
    (memory: AgentMemoryItem): ContextMenuItem[] =>
      stateFilter === 'removed'
        ? [
            {
              key: 'restore',
              label: t('Restore memory'),
              icon: RotateCcw,
              onSelect: () => void restoreMemory(memory),
            },
          ]
        : [
            {
              key: 'delete',
              label: t('Remove memory'),
              icon: Trash2,
              destructive: true,
              onSelect: () => setConfirmDelete(memory),
            },
          ],
    [restoreMemory, stateFilter, setConfirmDelete],
  )

  return { openMemory, deleteMemory, restoreMemory, buildMenu }
}
