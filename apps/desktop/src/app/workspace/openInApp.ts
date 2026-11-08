import { useCallback, useEffect, useState } from 'react'

const OPEN_IN_APP = 'nuphos:open-in-app'

type Opener = (href: string) => unknown

/** Views outside a pane (Settings, menus, the sidebar) open a Nuphos link in the focused pane. */
export function openInApp(href: string) {
  window.dispatchEvent(new CustomEvent(OPEN_IN_APP, { detail: href }))
}

/** One listener per window, so one link moves only the focused pane. */
export function listenOpenInApp(openers: ReadonlyMap<string, Opener>, focusedPane: string) {
  const open = (event: Event) => {
    const href = (event as CustomEvent<unknown>).detail

    if (typeof href === 'string') openers.get(focusedPane)?.(href)
  }

  window.addEventListener(OPEN_IN_APP, open)

  return () => window.removeEventListener(OPEN_IN_APP, open)
}

/** Each pane registers how it opens a link; the window hands each link to the focused one. */
export function useOpenInApp(focusedPane: string) {
  const [openers] = useState(() => new Map<string, Opener>())

  useEffect(() => listenOpenInApp(openers, focusedPane), [openers, focusedPane])

  return useCallback(
    (pane: string, open: Opener) => {
      openers.set(pane, open)

      return () => {
        if (openers.get(pane) === open) openers.delete(pane)
      }
    },
    [openers],
  )
}
