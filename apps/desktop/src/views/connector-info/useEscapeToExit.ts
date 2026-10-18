import { useEffect } from 'react'

/** Calls `onExit` on Escape unless a dialog, menu or text field already claims the key. */
export function useEscapeToExit(onExit: (() => void) | undefined) {
  useEffect(() => {
    if (!onExit) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      if (document.querySelector('[role="dialog"], [role="alertdialog"], [role="menu"]')) return
      if (
        event.target instanceof HTMLElement &&
        event.target.closest('input, textarea, [contenteditable]')
      ) {
        return
      }
      onExit()
    }

    window.addEventListener('keydown', onKeyDown)

    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onExit])
}
