import { useState } from 'react'

/**
 * Run `reset` during the render in which `key` changes.
 *
 * This is the supported alternative to resetting state from an effect keyed on
 * the same values: React re-renders with the reset applied before it commits,
 * so the reset is visible at the same moment the effect version made it visible
 * — minus the extra committed frame that still showed the previous resource's
 * data. It does not run on mount; the initial state already covers that.
 *
 * `key` must be built from exactly the values the paired effect depends on,
 * otherwise the reset and the refetch drift apart.
 */
export function useResetOnKey(key: string, reset: () => void): void {
  const [lastKey, setLastKey] = useState(key)

  if (lastKey !== key) {
    setLastKey(key)
    reset()
  }
}
