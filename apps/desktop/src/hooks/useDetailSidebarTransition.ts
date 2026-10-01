import { useCallback, useEffect, useRef, useState } from 'react'

import type { RefObject } from 'react'

const DETAIL_SIDEBAR_WIDTH_FALLBACK_MS = 200

function parseCssTimeList(value: string): number[] {
  return value
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      if (part.endsWith('ms')) return Number.parseFloat(part) || 0
      if (part.endsWith('s')) return (Number.parseFloat(part) || 0) * 1000

      return Number.parseFloat(part) || 0
    })
}

function readMaxTransitionDuration(element: Element | null, fallback: number): number {
  if (typeof window === 'undefined' || !element) return fallback
  const style = getComputedStyle(element)
  const durations = parseCssTimeList(style.transitionDuration)
  const delays = parseCssTimeList(style.transitionDelay)
  const total = durations.map((duration, index) => duration + (delays[index] ?? 0))

  return Math.max(fallback, ...total)
}

export function useDetailSidebarTransition(
  onClose: () => void,
  panelRef?: RefObject<HTMLElement | null>,
  options?: { closeOnEscape?: boolean },
) {
  const closeOnEscape = options?.closeOnEscape ?? true
  const internalPanelRef = useRef<HTMLElement | null>(null)
  const resolvedPanelRef = panelRef ?? internalPanelRef
  const [open, setOpen] = useState(false)
  const [contentOpen, setContentOpen] = useState(false)
  const closeTimerRef = useRef<number | null>(null)
  const contentTimerRef = useRef<number | null>(null)
  const closingRef = useRef(false)

  useEffect(() => {
    let measureFrame = 0
    const openFrame = window.requestAnimationFrame(() => {
      setOpen(true)
      measureFrame = window.requestAnimationFrame(() => {
        const delay = readMaxTransitionDuration(
          resolvedPanelRef.current,
          DETAIL_SIDEBAR_WIDTH_FALLBACK_MS,
        )

        contentTimerRef.current = window.setTimeout(() => setContentOpen(true), delay)
      })
    })

    return () => {
      window.cancelAnimationFrame(openFrame)
      window.cancelAnimationFrame(measureFrame)
      if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current)
      if (contentTimerRef.current !== null) window.clearTimeout(contentTimerRef.current)
    }
  }, [resolvedPanelRef])

  const requestClose = useCallback(() => {
    if (closingRef.current) return
    closingRef.current = true
    if (contentTimerRef.current !== null) window.clearTimeout(contentTimerRef.current)
    setContentOpen(false)
    const frameDelay = readMaxTransitionDuration(
      resolvedPanelRef.current,
      DETAIL_SIDEBAR_WIDTH_FALLBACK_MS,
    )

    setOpen(false)
    closeTimerRef.current = window.setTimeout(() => {
      onClose()
    }, frameDelay)
  }, [onClose, resolvedPanelRef])

  // `closeOnEscape` lets a host surface hand ESC to a higher-priority action
  // (e.g. the agent chat's ESC-to-stop while a turn is streaming). The
  // `defaultPrevented` / `isComposing` guards leave dialogs/menus and IMEs
  // their own ESC.
  useEffect(() => {
    if (!closeOnEscape) return
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing) return
      requestClose()
    }
    document.addEventListener('keydown', onKeyDown)

    return () => document.removeEventListener('keydown', onKeyDown)
  }, [closeOnEscape, requestClose])

  return { contentOpen, open, panelRef: resolvedPanelRef, requestClose }
}
