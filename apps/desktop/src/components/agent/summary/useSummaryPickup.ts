import { useEffect, useState } from 'react'

import { createTabPickup } from './summaryPickup'

import type { PointerEvent as ReactPointerEvent } from 'react'

/**
 * A tab's press-to-drag gate (see `createTabPickup`). `begin` receives the press so
 * the drag starts where the pointer went down and the tab stays under the cursor.
 */
export function useTabPickup(threshold: number, begin: (press: PointerEvent) => void) {
  const [lifted, setLifted] = useState(false)
  const [pickup] = useState(() => createTabPickup(threshold, () => window))

  useEffect(() => () => pickup.cancel(), [pickup])

  const onPointerDown = (event: ReactPointerEvent) => {
    if (event.button !== 0 || event.ctrlKey || event.metaKey) return
    const press = event.nativeEvent

    pickup.press(press, () => {
      setLifted(true)
      begin(press)
    })
  }

  return {
    lifted,
    onPointerDown,
    drop: () => setLifted(false),
    consumeClick: pickup.consumeClick,
  }
}
