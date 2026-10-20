import { useCallback, useEffect, useRef } from 'react'

import { cssDurationMs } from '../lib/motion'

/** transitions.dev "Error state shake" for a `.t-input` element: returns its ref and a trigger that replays the shake and flashes the error border. */
export function useErrorShake<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const timers = useRef<number[]>([])

  const clear = useCallback(() => {
    timers.current.forEach((t) => window.clearTimeout(t))
    timers.current = []
    ref.current?.classList.remove('is-error', 'is-shaking')
  }, [])

  const shake = useCallback(() => {
    const el = ref.current

    if (!el) return
    clear()
    el.classList.add('is-error')
    el.getBoundingClientRect() // force the reflow that replays the animation
    el.classList.add('is-shaking')

    const shakeMs = cssDurationMs('--shake-dur-a', 80) * 2 + cssDurationMs('--shake-dur-b', 60) * 2

    timers.current = [
      window.setTimeout(() => el.classList.remove('is-shaking'), shakeMs + 20),
      window.setTimeout(
        () => el.classList.remove('is-error'),
        shakeMs + cssDurationMs('--revert-hold', 3000),
      ),
    ]
  }, [clear])

  useEffect(() => clear, [clear])

  return { ref, shake, clear }
}
