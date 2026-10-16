import { useCallback, useEffect, useRef } from 'react'

import { HOVER_MARQUEE_DELAY_MS, hoverMarqueeDurationMs } from '../lib/hoverMarquee'

/**
 * Reveals a single-line label clipped by a `.t-marquee` container: after the
 * pointer rests on its row for a moment, the label scrolls in place once until
 * its end is visible, and snaps back when the pointer leaves. The container's
 * edge fades follow the scroll position, so labels that fit never fade or move.
 *
 * `containerRef` goes on the `.t-marquee` element and `start` / `stop` on
 * whatever counts as "the row". A change of `label` resets it, so a title that
 * lands mid-hover is not left scrolled by the old one's distance.
 */
export function useHoverMarquee<C extends HTMLElement>(label: string) {
  const containerRef = useRef<C>(null)
  const timerRef = useRef<number | null>(null)
  const frameRef = useRef<number | null>(null)

  const stop = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }

    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current)
      frameRef.current = null
    }

    if (containerRef.current) containerRef.current.scrollLeft = 0
  }, [])

  const start = useCallback(() => {
    stop()
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    timerRef.current = window.setTimeout(() => {
      timerRef.current = null
      const container = containerRef.current

      if (!container) return

      // Measured now rather than on enter: hover-revealed trailing controls
      // have taken their space by the time the delay ends.
      const distance = container.scrollWidth - container.clientWidth

      if (distance <= 1) return

      const duration = hoverMarqueeDurationMs(distance)
      const startedAt = performance.now()
      const step = (now: number) => {
        // Linear, like a marquee: a constant reading speed with no ease at either end.
        const progress = Math.min(1, (now - startedAt) / duration)

        container.scrollLeft = distance * progress
        frameRef.current = progress < 1 ? requestAnimationFrame(step) : null
      }

      frameRef.current = requestAnimationFrame(step)
    }, HOVER_MARQUEE_DELAY_MS)
  }, [stop])

  useEffect(() => stop, [stop, label])

  return { containerRef, start, stop }
}
