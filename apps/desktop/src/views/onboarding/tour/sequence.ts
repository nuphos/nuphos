import { useReducedMotion } from 'framer-motion'
import { useCallback, useEffect, useRef, useState } from 'react'

/** Seconds to wait, then the change to make. */
export type SequenceStep = readonly [delay: number, change: () => void]

/**
 * Plays a page's demo once each time the page is shown, then reveals its button.
 * Reduce motion lands every step at once. `takeOver` stops it where it is, for a
 * person who starts clicking the demo themselves.
 */
export function useSequence(build: () => SequenceStep[]): {
  revealed: boolean
  takeOver: () => void
} {
  const reduce = useReducedMotion() ?? false
  const [revealed, setRevealed] = useState(false)
  const stopped = useRef(false)
  const [steps] = useState(build)

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    let index = 0
    const next = () => {
      if (stopped.current) return
      const step = steps[index]

      index += 1
      if (!step) {
        timer = setTimeout(() => setRevealed(true), reduce ? 0 : 200)

        return
      }
      timer = setTimeout(
        () => {
          if (stopped.current) return
          step[1]()
          next()
        },
        reduce ? 0 : step[0] * 1000,
      )
    }

    next()

    return () => clearTimeout(timer)
  }, [steps, reduce])

  const takeOver = useCallback(() => {
    stopped.current = true
    setRevealed(true)
  }, [])

  return { revealed, takeOver }
}
