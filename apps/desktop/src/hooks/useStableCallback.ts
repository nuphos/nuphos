import { useCallback, useInsertionEffect, useRef } from 'react'

/**
 * A render-stable identity for a callback that is recreated every render.
 *
 * The wrapper always invokes the latest version, so handing it to a memoized
 * child keeps the memo intact without freezing the behaviour at bind time.
 * Event handlers only — reading state through it during render would bypass
 * React's data flow.
 */
export function useStableCallback<A extends unknown[], R>(
  fn: (...args: A) => R,
): (...args: A) => R {
  const latest = useRef(fn)

  // Commit-phase assignment (React's own `useEffectEvent` polyfill shape) —
  // writing a ref during render is not safe under concurrent rendering.
  useInsertionEffect(() => {
    latest.current = fn
  })

  return useCallback((...args: A) => latest.current(...args), [])
}
