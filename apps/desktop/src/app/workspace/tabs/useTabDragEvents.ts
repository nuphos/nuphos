import { useCallback, useEffect } from 'react'

import type { TabDropPlacement } from './tabsTypes'
import type { TabDropTarget, TabPointerDrag } from './useTabDragPreview'
import type {
  Dispatch,
  MouseEvent as ReactMouseEvent,
  MutableRefObject,
  PointerEvent as ReactPointerEvent,
  SetStateAction,
} from 'react'

export function useTabDragEvents({
  onSelect,
  onReorder,
  tabRefs,
  setDraggingTabId,
  setDragOffsetX,
  setDragSlotWidth,
  setDropTarget,
  setTabDropSettling,
  resolveTabDropTarget,
  dropTargetRef,
  tabPointerDragRef,
  suppressTabClickRef,
  tabDropSettlingFrameRef,
  clearTabDragState,
}: {
  onSelect: (id: string) => void
  onReorder: (tabId: string, targetTabId: string, placement: TabDropPlacement) => void
  tabRefs: MutableRefObject<Map<string, HTMLDivElement>>
  setDraggingTabId: Dispatch<SetStateAction<string | null>>
  setDragOffsetX: Dispatch<SetStateAction<number>>
  setDragSlotWidth: Dispatch<SetStateAction<number>>
  setDropTarget: Dispatch<SetStateAction<TabDropTarget>>
  setTabDropSettling: Dispatch<SetStateAction<boolean>>
  resolveTabDropTarget: (
    clientX: number,
    clientY: number,
    sourceTabId: string,
    dragOffset: number,
  ) => TabDropTarget
  dropTargetRef: MutableRefObject<TabDropTarget>
  tabPointerDragRef: MutableRefObject<TabPointerDrag | null>
  suppressTabClickRef: MutableRefObject<string | null>
  tabDropSettlingFrameRef: MutableRefObject<number | null>
  clearTabDragState: () => void
}) {
  useEffect(() => {
    const updateDrag = (clientX: number, clientY: number) => {
      const drag = tabPointerDragRef.current

      if (!drag) return false

      const distance = Math.hypot(clientX - drag.startX, clientY - drag.startY)

      if (!drag.dragging && distance < 6) return false

      if (!drag.dragging) {
        drag.dragging = true
        onSelect(drag.id)
        setDraggingTabId(drag.id)
        const rect = tabRefs.current.get(drag.id)?.getBoundingClientRect()

        setDragSlotWidth(rect?.width ?? 0)
      }
      setDragOffsetX(clientX - drag.startX)

      const nextTarget = resolveTabDropTarget(clientX, clientY, drag.id, clientX - drag.startX)

      // Keep the ref in lockstep with the computed target synchronously. The
      // dropTarget→ref sync effect runs after render, so a quick pointer-up
      // firing before that commit would otherwise read a stale target during
      // finishDrag.
      dropTargetRef.current = nextTarget
      setDropTarget((prev) =>
        prev?.id === nextTarget?.id && prev?.placement === nextTarget?.placement
          ? prev
          : nextTarget,
      )

      return true
    }

    const finishDrag = () => {
      const drag = tabPointerDragRef.current

      if (!drag) return

      const target = dropTargetRef.current

      if (drag.dragging && target && target.id !== drag.id) {
        onReorder(drag.id, target.id, target.placement)
        suppressTabClickRef.current = drag.id
        window.setTimeout(() => {
          if (suppressTabClickRef.current === drag.id) {
            suppressTabClickRef.current = null
          }
        }, 200)
      }

      if (drag.dragging) {
        if (tabDropSettlingFrameRef.current !== null) {
          window.cancelAnimationFrame(tabDropSettlingFrameRef.current)
        }
        setTabDropSettling(true)
        tabDropSettlingFrameRef.current = window.requestAnimationFrame(() => {
          tabDropSettlingFrameRef.current = window.requestAnimationFrame(() => {
            setTabDropSettling(false)
            tabDropSettlingFrameRef.current = null
          })
        })
      }

      tabPointerDragRef.current = null
      clearTabDragState()
    }

    const handlePointerMove = (event: PointerEvent) => {
      const drag = tabPointerDragRef.current

      if (drag?.source !== 'pointer' || event.pointerId !== drag.pointerId) {
        return
      }
      if (updateDrag(event.clientX, event.clientY)) {
        event.preventDefault()
      }
    }

    const handlePointerUp = (event: PointerEvent) => {
      const drag = tabPointerDragRef.current

      if (drag?.source !== 'pointer' || event.pointerId !== drag.pointerId) {
        return
      }
      finishDrag()
    }

    const handleMouseMove = (event: MouseEvent) => {
      const drag = tabPointerDragRef.current

      if (drag?.source !== 'mouse') return
      if (updateDrag(event.clientX, event.clientY)) {
        event.preventDefault()
      }
    }

    const handleMouseUp = () => {
      const drag = tabPointerDragRef.current

      if (drag?.source !== 'mouse') return
      finishDrag()
    }

    window.addEventListener('pointermove', handlePointerMove, { passive: false })
    window.addEventListener('pointerup', handlePointerUp)
    window.addEventListener('pointercancel', handlePointerUp)
    window.addEventListener('mousemove', handleMouseMove, { passive: false })
    window.addEventListener('mouseup', handleMouseUp)

    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
      window.removeEventListener('pointercancel', handlePointerUp)
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
      if (tabDropSettlingFrameRef.current !== null) {
        // A successful drop calls onReorder → new `tabs` → new
        // resolveTabDropTarget → this effect is torn down before the pending
        // settle rAF can fire. Reset the flag here so it can't get stuck at
        // true (which would disable every tab transition forever). The
        // transition-disabled frame already painted under the new tab order,
        // so re-enabling now is safe.
        window.cancelAnimationFrame(tabDropSettlingFrameRef.current)
        tabDropSettlingFrameRef.current = null
        setTabDropSettling(false)
      }
    }
  }, [
    clearTabDragState,
    dropTargetRef,
    onReorder,
    onSelect,
    resolveTabDropTarget,
    setDragOffsetX,
    setDragSlotWidth,
    setDraggingTabId,
    setDropTarget,
    setTabDropSettling,
    suppressTabClickRef,
    tabDropSettlingFrameRef,
    tabPointerDragRef,
    tabRefs,
  ])

  const handleTabPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>, tabId: string) => {
      if (event.button !== 0) return
      event.currentTarget.setPointerCapture(event.pointerId)
      tabPointerDragRef.current = {
        id: tabId,
        pointerId: event.pointerId,
        source: 'pointer',
        startX: event.clientX,
        startY: event.clientY,
        dragging: false,
      }
    },
    [tabPointerDragRef],
  )

  const handleTabMouseDown = useCallback(
    (event: ReactMouseEvent<HTMLButtonElement>, tabId: string) => {
      if (event.button !== 0) return
      if (tabPointerDragRef.current?.source === 'pointer') return
      tabPointerDragRef.current = {
        id: tabId,
        pointerId: null,
        source: 'mouse',
        startX: event.clientX,
        startY: event.clientY,
        dragging: false,
      }
    },
    [tabPointerDragRef],
  )

  return { handleTabPointerDown, handleTabMouseDown }
}
