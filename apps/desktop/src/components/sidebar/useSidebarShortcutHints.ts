import { useEffect, useState } from 'react'

import { isMac } from '../../lib/platform'

/** Holding the platform modifier reveals positions; normal taps keep the bar quiet. */
export function useSidebarShortcutHints() {
  const [shown, setShown] = useState(false)

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    let holding = false
    const cancel = () => {
      clearTimeout(timer)
      timer = undefined
      holding = false
      setShown(false)
    }
    const update = (event: KeyboardEvent) => {
      const modifier = isMac ? event.ctrlKey && !event.altKey : event.altKey && !event.ctrlKey

      if (!modifier || event.metaKey || event.shiftKey || event.isComposing) {
        cancel()

        return
      }
      if (holding) return
      holding = true
      timer = setTimeout(() => {
        timer = undefined
        if (!document.querySelector('[aria-modal="true"]')) setShown(true)
      }, 600)
    }

    window.addEventListener('keydown', update, true)
    window.addEventListener('keyup', update, true)
    window.addEventListener('blur', cancel)
    document.addEventListener('visibilitychange', cancel)

    return () => {
      clearTimeout(timer)
      window.removeEventListener('keydown', update, true)
      window.removeEventListener('keyup', update, true)
      window.removeEventListener('blur', cancel)
      document.removeEventListener('visibilitychange', cancel)
    }
  }, [])

  return shown
}
