import { useEffect, useRef, useState } from 'react'

import type { PointerEvent as ReactPointerEvent } from 'react'

/**
 * Decides when a press on a tab becomes a drag, so clicks and swipes stay clicks:
 * the tab is picked up once the pointer travels `threshold` px. `begin` receives
 * the press so the drag starts where the pointer went down and the tab stays
 * under the cursor.
 */
export function useTabPickup(threshold: number, begin: (press: PointerEvent) => void) {
  const [lifted, setLifted] = useState(false)
  const cleanup = useRef<(() => void) | null>(null)
  /** Set once a press turned into a pickup, so the click that follows is swallowed. */
  const picked = useRef(false)

  useEffect(() => () => cleanup.current?.(), [])

  const onPointerDown = (event: ReactPointerEvent) => {
    if (event.button !== 0 || event.ctrlKey || event.metaKey) return
    cleanup.current?.()
    picked.current = false
    const press = event.nativeEvent
    const stop = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', stop)
      window.removeEventListener('pointercancel', stop)
      cleanup.current = null
    }
    const move = (next: PointerEvent) => {
      if (Math.hypot(next.clientX - press.clientX, next.clientY - press.clientY) < threshold) return
      stop()
      picked.current = true
      setLifted(true)
      begin(press)
    }

    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop)
    window.addEventListener('pointercancel', stop)
    cleanup.current = stop
  }

  return {
    lifted,
    onPointerDown,
    drop: () => setLifted(false),
    /** True once for the click that ends a pickup. */
    consumeClick: () => {
      const swallow = picked.current

      picked.current = false

      return swallow
    },
  }
}
