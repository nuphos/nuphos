import { useReducedMotion } from 'framer-motion'
import { useEffect, useRef } from 'react'

import type { ReactNode } from 'react'

const LAYER =
  'col-start-1 row-start-1 transition-opacity duration-[var(--duration-medium)] ease-[var(--ease-in-out)] motion-reduce:transition-none'

/**
 * One text fading into another in place: both share one cell, so it holds the taller one's
 * height throughout and nothing around it moves. `onDone` hears once the new one has fully
 * shown; with reduced motion it swaps at once.
 */
export function Crossfade({
  from,
  to,
  swapped,
  onDone,
}: {
  from: ReactNode
  to: ReactNode
  swapped: boolean
  onDone?: () => void
}) {
  const reduce = useReducedMotion() ?? false
  const done = useRef(onDone)

  useEffect(() => {
    done.current = onDone
  })
  useEffect(() => {
    if (swapped && reduce) done.current?.()
  }, [swapped, reduce])

  return (
    <span className="grid">
      <span className={LAYER} style={{ opacity: swapped ? 0 : 1 }} aria-hidden={swapped}>
        {from}
      </span>
      <span
        className={LAYER}
        style={{ opacity: swapped ? 1 : 0 }}
        aria-hidden={!swapped}
        onTransitionEnd={(event) => {
          if (swapped && event.propertyName === 'opacity') done.current?.()
        }}
      >
        {to}
      </span>
    </span>
  )
}
