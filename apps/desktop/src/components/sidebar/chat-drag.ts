import { useRef, useState } from 'react'

import type { DragEvent } from 'react'

export type DragKind = 'chat' | 'project'
/** Where a drop lands: into the target, or on one side of it for reordering. */
export type DropPosition = 'inside' | 'before' | 'after'

const DRAG_TYPE: Record<DragKind, string> = {
  chat: 'application/x-nuphos-chat',
  project: 'application/x-nuphos-project',
}

// Drag data stays hidden until the drop, so targets read the dragged id here.
let dragged: { kind: DragKind; id: string } | null = null

/** Starts dragging a chat row or a project; only sidebar drop targets read the payload. */
export function startDrag(event: DragEvent, kind: DragKind, id: string): void {
  event.dataTransfer.setData(DRAG_TYPE[kind], id)
  event.dataTransfer.effectAllowed = 'move'
  dragged = { kind, id }
}

export function endDrag(): void {
  dragged = null
}

function draggedId(event: DragEvent, kind: DragKind): string | null {
  return event.dataTransfer.types.includes(DRAG_TYPE[kind]) && dragged?.kind === kind
    ? dragged.id
    : null
}

/** Before or after, by which half of the element's first child (its row) the pointer is over. */
function sideOf(event: DragEvent): DropPosition {
  const box = (event.currentTarget.firstElementChild ?? event.currentTarget).getBoundingClientRect()

  return event.clientY < box.top + box.height / 2 ? 'before' : 'after'
}

/**
 * Makes an element accept one kind of drag. `over` says where the drop would
 * land while something acceptable hovers; enter and leave are counted so
 * crossing child elements does not flicker. Without `onDrop` it ignores drags.
 */
export function useDropTarget({
  kind,
  onDrop,
  accepts = () => true,
  sided = false,
}: {
  kind: DragKind
  onDrop: ((id: string, position: DropPosition) => void) | undefined
  accepts?: (id: string) => boolean
  /** Reorder targets drop before or after themselves instead of inside. */
  sided?: boolean
}) {
  const depth = useRef(0)
  const [over, setOver] = useState<DropPosition | null>(null)

  if (!onDrop) return { over: null, props: {} }
  const acceptable = (event: DragEvent) => {
    const id = draggedId(event, kind)

    return id !== null && accepts(id) ? id : null
  }
  const hover = (event: DragEvent) => {
    event.preventDefault()
    event.stopPropagation()
    event.dataTransfer.dropEffect = 'move'
    setOver(sided ? sideOf(event) : 'inside')
  }

  return {
    over,
    props: {
      onDragEnter: (event: DragEvent) => {
        if (acceptable(event) === null) return
        depth.current += 1
        hover(event)
      },
      onDragOver: (event: DragEvent) => {
        if (acceptable(event) !== null) hover(event)
      },
      onDragLeave: (event: DragEvent) => {
        if (acceptable(event) === null) return
        event.stopPropagation()
        depth.current = Math.max(0, depth.current - 1)
        if (depth.current === 0) setOver(null)
      },
      onDrop: (event: DragEvent) => {
        const id = acceptable(event)
        const position = sided ? sideOf(event) : 'inside'

        depth.current = 0
        setOver(null)
        if (id === null) return
        event.preventDefault()
        event.stopPropagation()
        endDrag()
        onDrop(id, position)
      },
    },
  }
}
