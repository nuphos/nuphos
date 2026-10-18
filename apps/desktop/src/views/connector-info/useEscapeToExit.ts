import { useEffect } from 'react'

import { useWorkspacePane } from '../../app/workspace/WorkspacePaneContext'

import { escapeLeavesView } from './escapeToExit'

import type { RefObject } from 'react'

/** Calls `onExit` on Escape for the detail view inside `containerRef`, then consumes the key. */
export function useEscapeToExit(
  onExit: (() => void) | undefined,
  containerRef: RefObject<HTMLElement | null>,
) {
  const paneActive = useWorkspacePane()?.active ?? true

  useEffect(() => {
    if (!onExit) return
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target instanceof HTMLElement ? event.target : null
      const leaves = escapeLeavesView({
        key: event.key,
        handled: event.defaultPrevented,
        overlayOpen: Boolean(
          document.querySelector('[role="dialog"], [role="alertdialog"], [role="menu"]'),
        ),
        inField: Boolean(target?.closest('input, textarea, [contenteditable]')),
        inView: Boolean(target && containerRef.current?.contains(target)),
        inOtherView: Boolean(
          target?.closest('[data-connector-detail]') && !containerRef.current?.contains(target),
        ),
        paneActive,
      })

      if (!leaves) return
      event.preventDefault()
      onExit()
    }

    window.addEventListener('keydown', onKeyDown)

    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onExit, containerRef, paneActive])
}
