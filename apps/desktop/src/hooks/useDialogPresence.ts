import { useEffect, useState } from 'react'

/**
 * For a Base UI Dialog that its parent mounts to open and unmounts to close:
 * opening one frame after mount lets the popup play its `data-starting-style`
 * transition, and `onClose` waits for the closing transition to finish.
 */
export function useDialogPresence(onClose: () => void) {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const raf = requestAnimationFrame(() => setOpen(true))

    return () => cancelAnimationFrame(raf)
  }, [])

  return {
    open,
    onOpenChange: (next: boolean) => {
      if (!next) setOpen(false)
    },
    onOpenChangeComplete: (next: boolean) => {
      if (!next) onClose()
    },
  }
}
