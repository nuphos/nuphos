import { useCallback, useEffect, useMemo, useRef } from 'react'

import type { TabDropPlacement } from './tabsTypes'
import type { WorkspaceTabState } from '../../workspaceTabState'
import type { Dispatch, MutableRefObject, SetStateAction } from 'react'

export type TabDropTarget = { id: string; placement: TabDropPlacement } | null

export type TabPointerDrag = {
  id: string
  pointerId: number | null
  source: 'pointer' | 'mouse'
  startX: number
  startY: number
  dragging: boolean
}

export function useTabDragPreview({
  tabs,
  tabRefs,
  draggingTabId,
  dropTarget,
  dragSlotWidth,
  setDraggingTabId,
  setDropTarget,
  setDragOffsetX,
  setDragSlotWidth,
}: {
  tabs: WorkspaceTabState[]
  tabRefs: MutableRefObject<Map<string, HTMLDivElement>>
  draggingTabId: string | null
  dropTarget: TabDropTarget
  dragSlotWidth: number
  setDraggingTabId: Dispatch<SetStateAction<string | null>>
  setDropTarget: Dispatch<SetStateAction<TabDropTarget>>
  setDragOffsetX: Dispatch<SetStateAction<number>>
  setDragSlotWidth: Dispatch<SetStateAction<number>>
}) {
  const clearTabDragState = useCallback(() => {
    setDraggingTabId(null)
    setDropTarget(null)
    setDragOffsetX(0)
    setDragSlotWidth(0)
  }, [setDragOffsetX, setDragSlotWidth, setDraggingTabId, setDropTarget])

  const dropTargetRef = useRef(dropTarget)

  useEffect(() => {
    dropTargetRef.current = dropTarget
  }, [dropTarget])
  const tabDropSettlingFrameRef = useRef<number | null>(null)

  const tabPointerDragRef = useRef<{
    id: string
    pointerId: number | null
    source: 'pointer' | 'mouse'
    startX: number
    startY: number
    dragging: boolean
  } | null>(null)
  const suppressTabClickRef = useRef<string | null>(null)

  const resolveTabDropTarget = useCallback(
    (clientX: number, clientY: number, sourceTabId: string, dragOffset: number) => {
      const orderedTabs = tabs
        .map((tab) => {
          const rect = tabRefs.current.get(tab.id)?.getBoundingClientRect()

          return rect ? { id: tab.id, rect } : null
        })
        .filter((item): item is { id: string; rect: DOMRect } => Boolean(item))

      const visibleTabs = orderedTabs.filter((item) => item.id !== sourceTabId)

      if (!visibleTabs.length) return null

      const stripTop = Math.min(...visibleTabs.map((item) => item.rect.top))
      const stripBottom = Math.max(...visibleTabs.map((item) => item.rect.bottom))

      if (clientY < stripTop - 12 || clientY > stripBottom + 12) return null

      const hit = visibleTabs.find(({ rect }) => clientX >= rect.left && clientX <= rect.right)

      if (hit) {
        const sourceIndex = tabs.findIndex((tab) => tab.id === sourceTabId)
        const targetIndex = tabs.findIndex((tab) => tab.id === hit.id)
        const progress = (clientX - hit.rect.left) / hit.rect.width
        const movingRight = dragOffset > 0 || sourceIndex < targetIndex
        const placement: TabDropPlacement = movingRight
          ? progress > 0.25
            ? 'after'
            : 'before'
          : progress < 0.75
            ? 'before'
            : 'after'

        return {
          id: hit.id,
          placement,
        } satisfies { id: string; placement: TabDropPlacement }
      }

      const first = visibleTabs[0]
      const last = visibleTabs[visibleTabs.length - 1]

      if (first && clientX < first.rect.left) {
        return { id: first.id, placement: 'before' } satisfies {
          id: string
          placement: TabDropPlacement
        }
      }
      if (last && clientX > last.rect.right) {
        return { id: last.id, placement: 'after' } satisfies {
          id: string
          placement: TabDropPlacement
        }
      }

      for (let index = 1; index < visibleTabs.length; index += 1) {
        const prev = visibleTabs[index - 1]
        const next = visibleTabs[index]

        if (prev && next && clientX > prev.rect.right && clientX < next.rect.left) {
          return { id: next.id, placement: 'before' } satisfies {
            id: string
            placement: TabDropPlacement
          }
        }
      }

      return null
    },
    [tabRefs, tabs],
  )

  const tabPreviewOffsets = useMemo(() => {
    if (!draggingTabId || !dropTarget) return new Map<string, number>()

    const sourceIndex = tabs.findIndex((tab) => tab.id === draggingTabId)

    if (sourceIndex === -1) return new Map<string, number>()

    // `dragSlotWidth` is measured when the drag starts; re-measuring here
    // would be a DOM read during render.
    if (dragSlotWidth <= 0) return new Map<string, number>()

    const nextOrder = tabs.filter((tab) => tab.id !== draggingTabId)
    const targetIndex = nextOrder.findIndex((tab) => tab.id === dropTarget.id)
    const sourceTab = tabs[sourceIndex]

    if (targetIndex === -1 || !sourceTab) return new Map<string, number>()

    const insertIndex = dropTarget.placement === 'after' ? targetIndex + 1 : targetIndex

    nextOrder.splice(insertIndex, 0, sourceTab)

    const movement = dragSlotWidth + 4
    const offsets = new Map<string, number>()

    tabs.forEach((tab, originalIndex) => {
      if (tab.id === draggingTabId) return
      const previewIndex = nextOrder.findIndex((item) => item.id === tab.id)

      if (previewIndex === -1 || previewIndex === originalIndex) return
      offsets.set(tab.id, previewIndex > originalIndex ? movement : -movement)
    })

    return offsets
  }, [dragSlotWidth, draggingTabId, dropTarget, tabs])

  return {
    clearTabDragState,
    dropTargetRef,
    tabDropSettlingFrameRef,
    tabPointerDragRef,
    suppressTabClickRef,
    resolveTabDropTarget,
    tabPreviewOffsets,
  }
}
