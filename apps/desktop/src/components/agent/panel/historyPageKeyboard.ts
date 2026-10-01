import { useEffect, useLayoutEffect, useRef } from 'react'

import { useWorkspacePane } from '../../../app/workspace/WorkspacePaneContext'

import type { AgentConversation } from '../../../api'

// Up/Down walks the list the way a mail reader does. Bound to the window
// rather than the list, so it works without clicking into the rail first —
// and it preventDefaults, because the browser's own meaning for these keys
// here is to scroll the rail, which fights the selection it should follow.
export function useHistoryKeyboardNavigation({
  keyboardNavigation,
  items,
  selectedSessionId,
  onOpenConversation,
}: {
  keyboardNavigation: boolean
  items: AgentConversation[]
  selectedSessionId: string | null
  onOpenConversation: (sessionId: string, titleHint?: string, newTab?: boolean) => void
}) {
  const paneActive = useWorkspacePane()?.active ?? true
  const openConversationRef = useRef(onOpenConversation)
  // Set by the arrow-key walk so the scroll effect below knows to move focus
  // with the selection; mouse selection leaves it false.
  const keyboardMoveRef = useRef(false)

  useLayoutEffect(() => {
    openConversationRef.current = onOpenConversation
  }, [onOpenConversation])
  useEffect(() => {
    if (!paneActive || !keyboardNavigation || items.length === 0) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return
      // Never steal the arrows from somewhere text is being entered — the
      // reader's own composer sits beside this list.
      const target = event.target as HTMLElement | null

      if (
        target?.isContentEditable ||
        (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))
      ) {
        return
      }
      event.preventDefault()
      const current = items.findIndex((c) => c.sessionId === selectedSessionId)
      // Nothing selected yet: either arrow enters the list at the near end.
      const nextIndex =
        current === -1
          ? event.key === 'ArrowDown'
            ? 0
            : items.length - 1
          : Math.min(items.length - 1, Math.max(0, current + (event.key === 'ArrowDown' ? 1 : -1)))
      const next = items[nextIndex]

      if (!next || next.sessionId === selectedSessionId) return
      keyboardMoveRef.current = true
      openConversationRef.current(next.sessionId, next.title || next.firstMessage)
    }

    window.addEventListener('keydown', onKeyDown)

    return () => window.removeEventListener('keydown', onKeyDown)
  }, [paneActive, keyboardNavigation, items, selectedSessionId])

  // Keep the walked-to row on screen; `nearest` scrolls only when it has to,
  // so mouse selection doesn't yank the list around. A keyboard move also takes
  // focus with it — otherwise focus stays on whichever row was last clicked and
  // shows a focus ring on a row that is no longer the selected one.
  const selectedRowRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!selectedSessionId) return
    const row = selectedRowRef.current

    row?.scrollIntoView({ block: 'nearest' })
    if (keyboardMoveRef.current) {
      keyboardMoveRef.current = false
      // preventScroll: the scrollIntoView above already placed it.
      row?.querySelector('button')?.focus({ preventScroll: true })
    }
  }, [selectedSessionId])

  return selectedRowRef
}
