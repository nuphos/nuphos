import { useEffect, useRef } from 'react'

// Calls `onClosed` when the last open dialog closes.
export function useDialogsClosed(open: readonly boolean[], onClosed: (() => void) | undefined) {
  const anyOpen = open.some(Boolean)
  const wasOpenRef = useRef(anyOpen)

  useEffect(() => {
    const closed = wasOpenRef.current && !anyOpen

    wasOpenRef.current = anyOpen
    if (closed) onClosed?.()
  }, [anyOpen, onClosed])
}
