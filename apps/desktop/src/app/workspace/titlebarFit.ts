import { useCallback, useState } from 'react'

/**
 * How much of an agent pane's header fits its width. Split panes get narrow:
 * six of them in a 1,480px window are under 250px each, and the header's
 * controls alone need about that. `compact` drops the Share label and keeps one
 * avatar; `tight` also moves the summary toggle into the ⋯ menu.
 */
export type TitlebarFit = 'full' | 'compact' | 'tight'

// The header's content width, so the traffic-light and dock-toggle padding is
// already taken off.
const COMPACT_BELOW = 300
const TIGHT_BELOW = 210

export function titlebarFit(width: number): TitlebarFit {
  if (width < TIGHT_BELOW) return 'tight'
  if (width < COMPACT_BELOW) return 'compact'

  return 'full'
}

/** Measures the header it is attached to; a callback ref, so it follows a remount. */
export function useTitlebarFit() {
  const [fit, setFit] = useState<TitlebarFit>('full')
  const ref = useCallback((element: HTMLElement | null) => {
    if (!element) return
    const observer = new ResizeObserver(([entry]) => setFit(titlebarFit(entry.contentRect.width)))

    observer.observe(element)

    return () => observer.disconnect()
  }, [])

  return [ref, { compact: fit !== 'full', tight: fit === 'tight' }] as const
}
