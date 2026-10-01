import { useState } from 'react'

/** Counts the times `shown` turns true, so a kept-mounted view can replay its entrance. */
export function useEntranceCount(shown: boolean): number {
  const [count, setCount] = useState(0)
  const [wasShown, setWasShown] = useState(shown)

  if (shown !== wasShown) {
    setWasShown(shown)
    if (shown) setCount((n) => n + 1)
  }

  return count
}
