import { useCallback, useEffect, useRef, useState } from 'react'

import { paneRects, previewDrop } from './splitLayout'

import type { DropPreview, SplitLayout } from './splitLayout'
import type { SetStateAction } from 'react'

/** One curve for every moving part of a drop preview: a quick start that eases into place. */
export const GLIDE = 'duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]'

/** How long panes keep gliding after a drag stops, so a cancelled drag slides back. */
const SETTLE_MS = 340

/**
 * Where every pane would sit if the current drag were let go now. Panes glide
 * only around a drag; resizes and splits outside one stay instant.
 */
export function usePaneDropPreview(layout: SplitLayout) {
  const [preview, setPreview] = useState<DropPreview | null>(null)
  const [settling, setSettling] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const onPreview = useCallback((action: SetStateAction<DropPreview | null>) => {
    setPreview(action)
    setSettling(true)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setSettling(false), SETTLE_MS)
  }, [])

  useEffect(() => () => clearTimeout(timer.current), [])

  const placed = new Map(paneRects(previewDrop(layout, preview)).map((rect) => [rect.id, rect]))

  return { placed, gliding: preview !== null || settling, onPreview }
}
