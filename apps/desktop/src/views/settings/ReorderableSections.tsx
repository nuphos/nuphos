import clsx from 'clsx'
import { useLayoutEffect, useRef, useState } from 'react'

import { SectionGrip } from './SectionGrip'
import {
  beforeIdAt,
  dropIndexAt,
  isNoopDrop,
  moveAnnouncement,
  moveSection,
} from './sectionOrderPresentation'

import type { DragEvent, ReactNode } from 'react'

// Only a section's own grip may drop here, not a chat dragged in from the sidebar.
const SECTION_DRAG_TYPE = 'application/x-nuphos-page-section'
const MOVE_MS = 200

/**
 * A page's top-level sections in a saved order the reader can change, Notion style:
 * each section gets a grip in the left gutter to drag it by or open a move menu.
 * Sections that render nothing are left out, but keep their place in the order.
 */
export function ReorderableSections<T extends string>({
  order,
  sections,
  labels,
  editable,
  isDefault,
  onChange,
  onReset,
}: {
  order: readonly T[]
  sections: Record<T, ReactNode>
  labels: Record<T, string>
  /** False while there is nowhere to save the order; the grips stay hidden. */
  editable: boolean
  isDefault: boolean
  onChange: (order: T[]) => void
  onReset: () => void
}) {
  const visible = order.filter((id) => sections[id] !== null && sections[id] !== false)
  const [dragging, setDragging] = useState<T | null>(null)
  const [dropIndex, setDropIndex] = useState<number | null>(null)
  const [announcement, setAnnouncement] = useState('')
  const blocks = useRef(new Map<T, HTMLDivElement>())
  const grips = useRef(new Map<T, HTMLButtonElement>())
  // Where each section sat before a move, so it can glide from there to its new place.
  const lastTops = useRef<Map<T, number> | null>(null)
  const refocus = useRef<T | null>(null)

  // A refresh can unmount the dragged section, and then its dragend never fires.
  if (dragging !== null && !visible.includes(dragging)) {
    setDragging(null)
    setDropIndex(null)
  }

  const rememberTops = () => {
    lastTops.current = new Map(
      [...blocks.current].map(([key, el]) => [key, el.getBoundingClientRect().top]),
    )
  }
  const move = (id: T, beforeId: T | null, focusGrip: boolean) => {
    const next = moveSection(order, id, beforeId)

    if (next.join() === order.join()) return
    rememberTops()
    refocus.current = focusGrip ? id : null
    const shown = moveSection(visible, id, beforeId)

    setAnnouncement(moveAnnouncement(labels[id], shown.indexOf(id) + 1, shown.length))
    onChange(next)
  }

  // Keyed on the full order: a reset that only moves a hidden section must still
  // clear these refs, or a later filter change would refocus and animate from them.
  const orderKey = order.join()

  useLayoutEffect(() => {
    const tops = lastTops.current

    lastTops.current = null
    // React re-inserts moved nodes, which drops focus from a grip that was in use.
    if (refocus.current) grips.current.get(refocus.current)?.focus()
    refocus.current = null
    if (!tops || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    for (const [id, el] of blocks.current) {
      const from = tops.get(id)
      const delta = from === undefined ? 0 : from - el.getBoundingClientRect().top

      if (Math.abs(delta) < 1) continue
      el.animate([{ transform: `translateY(${String(delta)}px)` }, { transform: 'none' }], {
        duration: MOVE_MS,
        easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
      })
    }
  }, [orderKey])

  const endDrag = () => {
    setDragging(null)
    setDropIndex(null)
  }
  const onDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (dragging === null || !event.dataTransfer.types.includes(SECTION_DRAG_TYPE)) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    const rects = visible.map((id) => {
      const rect = blocks.current.get(id)?.getBoundingClientRect()

      return { top: rect?.top ?? 0, height: rect?.height ?? 0 }
    })
    const index = dropIndexAt(event.clientY, rects)

    setDropIndex(isNoopDrop(visible.indexOf(dragging), index) ? null : index)
  }
  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    if (dragging === null || dropIndex === null) return endDrag()
    event.preventDefault()
    move(dragging, beforeIdAt(visible, dropIndex), false)
    endDrag()
  }

  return (
    <div
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropIndex(null)
      }}
      className="flex flex-col gap-6"
    >
      {visible.map((id, index) => (
        <div
          key={id}
          ref={(el) => {
            if (el) blocks.current.set(id, el)
            else blocks.current.delete(id)
          }}
          className={clsx(
            'group/section relative min-w-0 transition-opacity motion-reduce:transition-none',
            dragging === id && 'opacity-40',
          )}
        >
          {dropIndex === index && <DropLine edge="top" />}
          {dropIndex === visible.length && index === visible.length - 1 && (
            <DropLine edge="bottom" />
          )}
          {editable && (
            <SectionGrip
              ref={(el) => {
                if (el) grips.current.set(id, el)
                else grips.current.delete(id)
              }}
              label={labels[id]}
              canMoveUp={index > 0}
              canMoveDown={index < visible.length - 1}
              canReset={!isDefault}
              onMove={(step) =>
                move(id, beforeIdAt(visible, step === -1 ? index - 1 : index + 2), true)
              }
              onReset={() => {
                rememberTops()
                refocus.current = id
                setAnnouncement('Section order reset')
                onReset()
              }}
              onDragStart={(event) => {
                liftSection(event, id, blocks.current.get(id))
                setDragging(id)
              }}
              onDragEnd={endDrag}
            />
          )}
          {sections[id]}
        </div>
      ))}
      <div role="status" aria-live="polite" className="sr-only">
        {announcement}
      </div>
    </div>
  )
}

/** Starts a section drag, with the whole section rather than the grip as the preview. */
function liftSection(event: DragEvent<HTMLElement>, id: string, block: HTMLElement | undefined) {
  event.dataTransfer.effectAllowed = 'move'
  event.dataTransfer.setData(SECTION_DRAG_TYPE, id)
  if (!block) return
  const rect = block.getBoundingClientRect()

  event.dataTransfer.setDragImage(block, event.clientX - rect.left, event.clientY - rect.top)
}

/** The accent line in the gap a dragged section will land in. */
function DropLine({ edge }: { edge: 'top' | 'bottom' }) {
  return (
    <div
      aria-hidden="true"
      className={clsx(
        'pointer-events-none absolute inset-x-0 z-10 h-0.5 rounded-full bg-zViolet-500',
        edge === 'top' ? '-top-[13px]' : '-bottom-[13px]',
      )}
    />
  )
}
