import { dataTransferHasFiles } from './attachmentDrag'

import type { DragEvent } from 'react'

type DropTarget = ((dt: DataTransfer) => void) | null

/**
 * A pane that takes dropped files anywhere on it and hands them to `target()`,
 * the composer showing in it. `depth` counts nested dragenter/leave so the
 * affordance does not flicker as the drag crosses children.
 */
export function fileDropHandlers({
  target,
  depth,
  setDragging,
}: {
  target: () => DropTarget
  depth: { current: number }
  setDragging: (dragging: boolean) => void
}) {
  return {
    onDragEnter: (e: DragEvent<HTMLDivElement>) => {
      if (!dataTransferHasFiles(e.dataTransfer)) return
      // Always preventDefault on a file drag so it never falls through to
      // Electron's default file-open/navigation, even when no composer is
      // registered (read-only / opening states).
      e.preventDefault()
      if (!target()) return
      depth.current += 1
      setDragging(true)
    },
    onDragOver: (e: DragEvent<HTMLDivElement>) => {
      if (!dataTransferHasFiles(e.dataTransfer)) return
      e.preventDefault() // block the browser default + let the drop event fire
      e.dataTransfer.dropEffect = target() ? 'copy' : 'none'
    },
    onDragLeave: (e: DragEvent<HTMLDivElement>) => {
      if (!dataTransferHasFiles(e.dataTransfer)) return
      depth.current = Math.max(0, depth.current - 1)
      if (depth.current === 0) setDragging(false)
    },
    onDrop: (e: DragEvent<HTMLDivElement>) => {
      if (!dataTransferHasFiles(e.dataTransfer)) return
      e.preventDefault() // block the default file-open even if we can't attach
      depth.current = 0
      setDragging(false)
      target()?.(e.dataTransfer)
    },
  }
}
