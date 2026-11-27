import { Reorder, useReducedMotion } from 'framer-motion'
import { ChevronDown, ChevronRight, GripVertical } from 'lucide-react'
import { useEffect, useEffectEvent, useRef, useState } from 'react'

import { t } from '../../../i18n'

import { focusRingClass, sectionClass } from './ChatSummaryRows'
import { SummaryLayoutActions, SummaryLayoutTitle } from './summaryLayoutContext'
import { DRAG_MOVE, useDeferredDrag } from './useSummaryArranging'

import type { ReactNode } from 'react'

/** A section keeps its mounted content while its handle moves the whole card. */
export function SortableSummarySection({
  id,
  title,
  content,
  collapsed,
  regionId,
  onToggle,
  onMove,
  onDrop,
  moving,
  layoutKey,
  onPickUp,
}: {
  id: string
  title: string
  content: ReactNode
  collapsed: boolean
  regionId: string
  onToggle: () => void
  onMove: (direction: number) => void
  onDrop: () => void
  moving: boolean
  layoutKey: string
  onPickUp: () => void
}) {
  const { controls, pickup } = useDeferredDrag(moving, onPickUp)
  const reduce = useReducedMotion()
  const [dragging, setDragging] = useState(false)
  const [actionTarget, setActionTarget] = useState<HTMLDivElement | null>(null)
  const handle = useRef<HTMLButtonElement>(null)
  const cancelDrag = useEffectEvent(() => {
    pickup.drop()
    onDrop()
  })
  const Chevron = collapsed ? ChevronRight : ChevronDown

  useEffect(() => {
    if (!dragging) return
    document.documentElement.classList.add('summary-dragging')
    const release = () => setDragging(false)

    const cancel = () => {
      controls.stop()
      cancelDrag()
      setDragging(false)
    }

    window.addEventListener('pointerup', release)
    window.addEventListener('pointercancel', cancel)

    return () => {
      document.documentElement.classList.remove('summary-dragging')
      window.removeEventListener('pointerup', release)
      window.removeEventListener('pointercancel', cancel)
    }
  }, [dragging, controls])

  return (
    <Reorder.Item
      as="section"
      aria-label={title}
      value={id}
      layout="position"
      layoutDependency={layoutKey}
      drag={moving ? 'y' : false}
      dragListener={false}
      dragControls={controls}
      dragMomentum={false}
      transition={reduce ? { duration: 0 } : DRAG_MOVE}
      whileDrag={{ zIndex: 10, opacity: 0.95 }}
      onDragStart={() => setDragging(true)}
      onDragEnd={() => {
        setDragging(false)
        pickup.drop()
        onDrop()
      }}
      className={`${sectionClass} relative min-w-0 bg-surface `}
      data-summary-section={id}
    >
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          className={`flex min-w-0 flex-1 items-center gap-2 text-left text-[13px] text-main ${focusRingClass}`}
          aria-expanded={!collapsed}
          aria-controls={`${regionId}-${id}`}
          onClick={onToggle}
        >
          <Chevron aria-hidden className="size-4 shrink-0" />
          <span className="truncate">{title}</span>
        </button>
        <div ref={setActionTarget} className="flex shrink-0 items-center" />
        <button
          ref={handle}
          type="button"
          className={`summary-drag-handle shrink-0 touch-none rounded p-1 text-tertiary ${focusRingClass}`}
          aria-label={`${t('Drag to reorder')}: ${title}`}
          aria-describedby={`${regionId}-help`}
          title={t('Drag to reorder')}
          onPointerDown={pickup.onPointerDown}
          onKeyDown={(event) => {
            if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
            event.preventDefault()
            event.stopPropagation()
            onMove(event.key === 'ArrowUp' ? -1 : 1)
            requestAnimationFrame(() => handle.current?.scrollIntoView({ block: 'nearest' }))
          }}
        >
          <GripVertical aria-hidden className="size-4" />
        </button>
      </div>
      <div id={`${regionId}-${id}`} hidden={collapsed} className="pt-2 empty:hidden">
        <SummaryLayoutActions
          value={{
            target: actionTarget,
            onAction: () => {
              if (collapsed) onToggle()
            },
          }}
        >
          <SummaryLayoutTitle value={title}>{content}</SummaryLayoutTitle>
        </SummaryLayoutActions>
      </div>
    </Reorder.Item>
  )
}
