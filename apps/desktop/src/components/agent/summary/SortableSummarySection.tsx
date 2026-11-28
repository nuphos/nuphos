import { Reorder, useReducedMotion } from 'framer-motion'
import { ChevronDown, ChevronRight, GripVertical } from 'lucide-react'
import { useEffect, useEffectEvent, useRef, useState } from 'react'

import { t } from '../../../i18n'

import { focusRingClass, sectionClass } from './ChatSummaryRows'
import { SummaryLayoutActions, SummaryLayoutTitle } from './summaryLayoutContext'
import { DRAG_MOVE, useDeferredDrag } from './useSummaryArranging'

import type { ReactNode } from 'react'

/** The menus' popover shadow: a card being carried floats above the others. */
const LIFTED_SHADOW = 'shadow-[0_10px_28px_-6px_rgba(0,0,0,0.6)]'

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
      whileDrag={{ zIndex: 10 }}
      onDragStart={() => setDragging(true)}
      onDragEnd={() => {
        setDragging(false)
        pickup.drop()
        onDrop()
      }}
      className={`${sectionClass} relative min-w-0 transition-[background-color,box-shadow] ${
        dragging ? `bg-surface-raised ${LIFTED_SHADOW}` : 'bg-surface'
      }`}
      data-dragging={dragging || undefined}
      data-summary-section={id}
    >
      <div className="group/header flex items-center justify-between gap-2">
        <button
          type="button"
          className={`flex min-w-0 flex-1 items-center gap-1.5 text-left text-[13px] font-medium text-main ${focusRingClass}`}
          aria-expanded={!collapsed}
          aria-controls={`${regionId}-${id}`}
          onClick={onToggle}
        >
          <span className="truncate">{title}</span>
          <span
            aria-hidden
            className="t-icon-swap size-3 shrink-0 text-tertiary"
            data-state={collapsed ? 'a' : 'b'}
          >
            <ChevronRight className="t-icon size-3" data-icon="a" />
            <ChevronDown className="t-icon size-3" data-icon="b" />
          </span>
        </button>
        <div ref={setActionTarget} className="flex shrink-0 items-center" />
        <button
          ref={handle}
          type="button"
          className={`summary-drag-handle shrink-0 touch-none rounded p-1 text-tertiary transition-opacity focus-visible:opacity-100 group-hover/header:opacity-100 [@media(hover:none)]:opacity-100 ${
            dragging ? 'opacity-100' : 'opacity-0'
          } ${focusRingClass}`}
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
