import { useEffect, useId, useRef, useState } from 'react'

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]'

function focusables(root: Element): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (el) => el.tabIndex >= 0 && el.checkVisibility() && !el.closest('[inert]'),
  )
}

/** Without a child's autoFocus, the first control in the body (not the header's ✕). */
export function focusIntoModal(panel: HTMLElement, body: HTMLElement | null) {
  if (panel.contains(document.activeElement)) return
  const target = (body && focusables(body).at(0)) ?? focusables(panel).at(0) ?? panel

  target.focus({ preventScroll: true })
}

/** Tab / ⇧Tab wrap inside the modal, so focus never reaches the page behind it. */
export function trapTab(event: KeyboardEvent, panel: HTMLElement) {
  const active = document.activeElement

  if (event.key !== 'Tab' || event.defaultPrevented || !active || !panel.contains(active)) return
  const items = focusables(panel)
  const first = items.at(0)
  const last = items.at(-1)

  if (!first || !last) {
    event.preventDefault()

    return
  }
  if (event.shiftKey && (active === first || active === panel)) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && active === last) {
    event.preventDefault()
    first.focus()
  }
}

/**
 * Keeps focus inside an open modal and hands it back when it closes or
 * unmounts. What had focus is read as `open` flips, before a child's autoFocus.
 */
export function useModalFocus(open: boolean) {
  const panelRef = useRef<HTMLDivElement | null>(null)
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const titleId = useId()
  const [wasOpen, setWasOpen] = useState(open)
  const [returnTo, setReturnTo] = useState<Element | null>(() =>
    open ? document.activeElement : null,
  )

  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) setReturnTo(document.activeElement)
  }

  useEffect(() => {
    const panel = panelRef.current

    if (!open || !panel) return
    const frame = requestAnimationFrame(() => focusIntoModal(panel, bodyRef.current))
    const onTab = (event: KeyboardEvent) => trapTab(event, panel)

    document.addEventListener('keydown', onTab)

    // Runs on close and on unmount alike: many callers mount `<Modal open>`
    // conditionally and never flip `open`. A detached panel leaves focus on body.
    return () => {
      cancelAnimationFrame(frame)
      document.removeEventListener('keydown', onTab)
      const active = document.activeElement
      const lost = !active || active === document.body || panel.contains(active)

      if (lost && returnTo instanceof HTMLElement && returnTo.isConnected) {
        returnTo.focus({ preventScroll: true })
      }
    }
  }, [open, returnTo])

  return { panelRef, bodyRef, titleId }
}
