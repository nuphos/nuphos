import { useLayoutEffect, useRef } from 'react'

type Previous = { left: number; top: number; animation?: Animation }

/** FLIP keeps each pin moving from its visible position when the grid reflows. */
export function usePinReflow(zone: HTMLElement | null) {
  const previous = useRef(new Map<string, Previous>())

  useLayoutEffect(() => {
    if (!zone) return
    const next = new Map<string, Previous>()
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    for (const element of zone.querySelectorAll<HTMLElement>('[data-pin-slot]')) {
      const key = element.dataset.pinSlot ?? ''
      const old = previous.current.get(key)
      const position: Previous = { left: element.offsetLeft, top: element.offsetTop }

      // Runtime and hover updates must not restart a move already in flight.
      // Retarget only when the grid's layout position actually changes.
      if (old?.left === position.left && old.top === position.top && !reduced) {
        next.set(key, old)
        continue
      }
      let x = 0,
        y = 0

      if (old?.animation) {
        const transform = getComputedStyle(element).transform

        if (transform && transform !== 'none') {
          const matrix = new DOMMatrixReadOnly(transform)

          x = matrix.m41
          y = matrix.m42
        }
        old.animation.cancel()
      }
      // Local layout coordinates ignore the swipe track's translate3d and
      // scrolling. Only moving a pin within this grid should trigger FLIP.
      if (old && !reduced) {
        const dx = old.left + x - position.left,
          dy = old.top + y - position.top

        if (Math.abs(dx) + Math.abs(dy) > 0.5)
          position.animation = element.animate(
            [
              { transform: `translate(${String(dx)}px,${String(dy)}px)` },
              { transform: 'translate(0,0)' },
            ],
            { duration: 180, easing: 'cubic-bezier(.22,1,.36,1)' },
          )
      }
      next.set(key, position)
    }
    for (const [key, old] of previous.current) if (!next.has(key)) old.animation?.cancel()
    previous.current = next
  })
  useLayoutEffect(
    () => () => {
      for (const old of previous.current.values()) old.animation?.cancel()
    },
    [],
  )
}
