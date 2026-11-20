import { useEffect } from 'react'

import { isChatSummaryShortcut } from '../../../lib/chatSummaryShortcut'
import { isMac } from '../../../lib/platform'

/**
 * ⌘I toggles the panel while `active`, which only the focused pane in front is.
 * `toggle` returns whether it took the key; false passes it on, to a view covering it.
 */
export function useChatSummaryShortcut(active: boolean, toggle: () => boolean) {
  useEffect(() => {
    if (!active) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || !isChatSummaryShortcut(event, isMac)) return
      if (toggle()) event.preventDefault()
    }

    window.addEventListener('keydown', onKeyDown)

    return () => window.removeEventListener('keydown', onKeyDown)
  }, [active, toggle])
}
