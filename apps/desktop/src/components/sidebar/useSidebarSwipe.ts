import { useLayoutEffect, useRef } from 'react'

import { api } from '../../api'

import { attachSidebarSwipe } from './sidebar-swipe-controller'
import { pageAtSlot, slotOf, trackStep } from './sidebar-tab-order'

import type { SidebarTabOrder } from './sidebar-tab-order'
import type { SidebarPage, SidebarPageChange } from './swipe-gesture'

/**
 * Track transforms are batched once per animation frame; React only sees committed pages.
 * The track works in slots (left to right on screen); `order` maps a slot to its page.
 */
export function useSidebarSwipe(
  page: SidebarPage,
  onPage: SidebarPageChange,
  order: SidebarTabOrder,
) {
  const viewport = useRef<HTMLDivElement>(null)
  const track = useRef<HTMLDivElement>(null)
  const change = useRef(onPage)
  const slots = useRef(order)
  const shown = useRef(page)
  const control = useRef<{
    go: (slot: SidebarPage) => void
    place: (slot: SidebarPage) => void
  } | null>(null)

  useLayoutEffect(() => {
    change.current = onPage
  }, [onPage])

  useLayoutEffect(() => {
    const el = viewport.current
    const layer = track.current

    if (!el || !layer) return
    const controller = attachSidebarSwipe(
      el,
      layer,
      slotOf(slots.current, page),
      (slot) => {
        const next = pageAtSlot(slots.current, slot)

        // Only a gesture picks a page. A slide to the page already shown has
        // nothing to report, and reporting it would reopen that page's home.
        if (next !== shown.current) change.current(next)
      },
      { onThreshold: () => api.sidebarAlignmentFeedback?.() },
    )
    const unsubscribe = api.onSidebarGesture?.(controller.nativePhase)

    control.current = controller

    return () => {
      unsubscribe?.()
      controller.destroy()
      control.current = null
    }
    // The controller owns gesture state; prop changes go through go(), without rebinding input.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useLayoutEffect(() => {
    // A new order moves the open page's panel along the track: jump there, don't slide.
    const step = trackStep(slots.current, order, page)

    shown.current = page
    slots.current = order
    if (step.jump) control.current?.place(step.slot)
    else control.current?.go(step.slot)
  }, [page, order])

  return { viewport, track }
}
