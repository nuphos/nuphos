/**
 * How long the pointer must rest on a row before a clipped label starts scrolling.
 * Deliberately longer than the tooltip intent delay: its job is to let a sweep
 * down a long list pass without setting every row in motion.
 */
export const HOVER_MARQUEE_DELAY_MS = 200

/** Scroll speed, so long titles take proportionally longer instead of racing past. */
const HOVER_MARQUEE_PX_PER_SECOND = 40
const HOVER_MARQUEE_MIN_DURATION_MS = 500
const HOVER_MARQUEE_MAX_DURATION_MS = 8000

/** Duration of the one-shot scroll that brings the clipped tail of a label into view. */
export function hoverMarqueeDurationMs(distancePx: number): number {
  const duration = (distancePx / HOVER_MARQUEE_PX_PER_SECOND) * 1000

  return Math.round(
    Math.min(HOVER_MARQUEE_MAX_DURATION_MS, Math.max(HOVER_MARQUEE_MIN_DURATION_MS, duration)),
  )
}
