import { animate, useMotionValue } from 'framer-motion'
import { useEffect, useRef } from 'react'
import { flushSync } from 'react-dom'

// Trackpads report no touch-up, so a gesture is over once its wheel stream
// goes quiet for this long. macOS momentum keeps the stream alive, which is
// what makes the post-commit latch below hold for the whole swipe.
const GESTURE_IDLE_MS = 140

/**
 * Finger-tracking strip pager for the schedule grids: wheel deltas along
 * `axis` drag a strip of equal units live (day columns for the time grids,
 * week rows for the month grid), and lifting off snaps to the nearest whole
 * unit. One swipe can travel several units; the snap count is whatever the
 * drag rounds to, clamped to the rendered buffer.
 *
 * Only the dominant axis of each wheel event counts, so scrolling a time
 * grid's hours never drags its day strip, and vice versa.
 */
export function useStripPager({
  axis,
  viewportRef,
  visibleUnits,
  maxUnits,
  onCommit,
  onGestureStart,
}: {
  axis: 'x' | 'y'
  /** Measured for the unit size — `visibleUnits` units fill the viewport. */
  viewportRef: React.RefObject<HTMLElement | null>
  visibleUnits: number
  /** Drag/snap bound, in units — the buffer the caller keeps rendered. */
  maxUnits: number
  /** Apply the unit shift once a snap completes. Runs inside flushSync so the
   *  window swap and the strip reset land in the same frame. */
  onCommit: (deltaUnits: number) => void
  /** A drag or programmatic slide just started — close popups and the like. */
  onGestureStart?: () => void
}) {
  const offset = useMotionValue(0)
  const phase = useRef<'idle' | 'dragging' | 'settling'>('idle')
  // Held from snap until the wheel stream goes quiet, so momentum from the
  // swipe that just stepped can't immediately step again.
  const latched = useRef(false)
  const unitSize = useRef(1)
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(
    () => () => {
      if (idleTimer.current) clearTimeout(idleTimer.current)
    },
    [],
  )

  const measure = () => {
    const el = viewportRef.current
    const length = (axis === 'x' ? el?.clientWidth : el?.clientHeight) ?? 1

    unitSize.current = Math.max(1, length / visibleUnits)
  }

  const settle = (units: number) => {
    phase.current = 'settling'
    if (units !== 0) latched.current = true
    animate(offset, -units * unitSize.current, {
      type: 'tween',
      duration: 0.2,
      ease: [0.25, 0.1, 0.25, 1],
      onComplete: () => {
        if (units !== 0) {
          // Shift the window and reset the strip in one frame: the units that
          // slid into view are re-rendered at rest in the same places.
          flushSync(() => onCommit(units))
          offset.jump(0)
        }
        phase.current = 'idle'
      },
    })
  }

  const onGestureEnd = () => {
    latched.current = false
    if (phase.current !== 'dragging') return
    const dragged = Math.round(-offset.get() / unitSize.current)

    settle(Math.max(-maxUnits, Math.min(maxUnits, dragged)))
  }

  const onWheel = (event: React.WheelEvent) => {
    const primary = axis === 'x' ? event.deltaX : event.deltaY
    const cross = axis === 'x' ? event.deltaY : event.deltaX

    if (Math.abs(primary) <= Math.abs(cross)) return

    if (idleTimer.current) clearTimeout(idleTimer.current)
    idleTimer.current = setTimeout(onGestureEnd, GESTURE_IDLE_MS)

    if (latched.current || phase.current === 'settling') return
    if (phase.current === 'idle') {
      measure()
      phase.current = 'dragging'
      onGestureStart?.()
    }
    // Natural direction: fingers left/up (positive delta) drag the strip
    // back, pulling later units in. Clamped to the rendered buffer.
    const max = maxUnits * unitSize.current
    const next = offset.get() - primary

    offset.set(Math.min(max, Math.max(-max, next)))
  }

  /** Animated multi-unit slide (header arrows page a view's worth). */
  const slideBy = (units: number) => {
    if (phase.current !== 'idle' || units === 0) return
    measure()
    onGestureStart?.()
    settle(Math.max(-maxUnits, Math.min(maxUnits, units)))
  }

  return { offset, onWheel, slideBy }
}
