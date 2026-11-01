import { useRef, useState } from 'react'

import {
  beforeIdAt,
  dropIndexAt,
  isNoopDrop,
  moveAnnouncement,
  moveSection,
} from '../../views/settings/sectionOrderPresentation'

import { pinnedBlocks, pinnedStepTarget } from './pinned-order'

import type { PinnedMoves } from './pinned-order'
import type { Item } from './types'
import type { DragEvent } from 'react'

// Rides along with the chat's own drag data, so only a Pinned row can drop
// here. A chat dragged from Agents has no such entry and is not accepted.
const PINNED_DRAG_TYPE = 'application/x-nuphos-pinned-chat'

/**
 * Reordering Pinned, the way the Agents page orders its sections: drag a row
 * (its sub-agents come with it) to an accent line where it will land, or use
 * Move up / Move down from its menu. Each move is read out to screen readers.
 */
export function usePinnedDrag(
  items: readonly Item[],
  movePinned: ((item: Item, before: Item | null) => void) | undefined,
) {
  const { heads, headOf } = pinnedBlocks(items)
  const [dragging, setDragging] = useState<string | null>(null)
  const [dropIndex, setDropIndex] = useState<number | null>(null)
  const [announcement, setAnnouncement] = useState('')
  const rows = useRef(new Map<string, HTMLElement>())
  const list = useRef<HTMLDivElement | null>(null)
  const byKey = new Map(items.map((item) => [item.key, item]))

  // A refresh can drop the dragged row, and then its dragend never fires.
  if (dragging !== null && !heads.includes(dragging)) {
    setDragging(null)
    setDropIndex(null)
  }

  const move = (key: string, before: string | null) => {
    const item = byKey.get(key)

    if (!item || !movePinned) return
    const shown = moveSection(heads, key, before)

    setAnnouncement(moveAnnouncement(item.label, shown.indexOf(key) + 1, shown.length))
    movePinned(item, before === null ? null : (byKey.get(before) ?? null))
  }
  const endDrag = () => {
    setDragging(null)
    setDropIndex(null)
  }
  // Each block runs from its top row down to the next block, or the list's end.
  const blockRects = () => {
    const end = list.current?.getBoundingClientRect().bottom ?? 0
    const tops = heads.map((key) => rows.current.get(key)?.getBoundingClientRect().top ?? 0)

    return tops.map((top, index) => ({ top, height: (tops[index + 1] ?? end) - top }))
  }

  const enabled = Boolean(movePinned) && heads.length > 1

  return {
    announcement,
    dropIndex,
    heads,
    listRef: list,
    /** Dims every row of the block being dragged. */
    isDragged: (key: string) => dragging !== null && headOf.get(key) === dragging,
    rowRef: (key: string) => (el: HTMLElement | null) => {
      if (el) rows.current.set(key, el)
      else rows.current.delete(key)
    },
    /** Extra drag data for a top-level Pinned row, or undefined for any other row. */
    rowDrag: (key: string) =>
      enabled && heads.includes(key)
        ? {
            onDragStart: (event: DragEvent<HTMLElement>) => {
              event.dataTransfer.setData(PINNED_DRAG_TYPE, key)
              setDragging(key)
            },
            onDragEnd: endDrag,
          }
        : undefined,
    listHandlers: enabled
      ? {
          onDragOver: (event: DragEvent<HTMLDivElement>) => {
            if (dragging === null || !event.dataTransfer.types.includes(PINNED_DRAG_TYPE)) return
            event.preventDefault()
            event.dataTransfer.dropEffect = 'move'
            const index = dropIndexAt(event.clientY, blockRects())

            setDropIndex(isNoopDrop(heads.indexOf(dragging), index) ? null : index)
          },
          onDrop: (event: DragEvent<HTMLDivElement>) => {
            if (dragging !== null && dropIndex !== null) {
              event.preventDefault()
              move(dragging, beforeIdAt(heads, dropIndex))
            }
            endDrag()
          },
          onDragLeave: (event: DragEvent<HTMLDivElement>) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
              setDropIndex(null)
            }
          },
        }
      : {},
    /** Move up / Move down for a top-level Pinned row's menu. */
    menuMoves: (key: string): PinnedMoves | undefined => {
      if (!enabled) return undefined
      const up = pinnedStepTarget(heads, key, -1)
      const down = pinnedStepTarget(heads, key, 1)

      return {
        up: up === undefined ? undefined : () => move(key, up),
        down: down === undefined ? undefined : () => move(key, down),
      }
    },
  }
}
