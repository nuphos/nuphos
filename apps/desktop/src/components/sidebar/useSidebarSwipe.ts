import { useLayoutEffect, useRef } from 'react'

import { api } from '../../api'

import { attachSidebarSwipe } from './sidebar-swipe-controller'
import { slotOf } from './sidebar-tab-order'

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
      (slot) => change.current(slots.current[slot]),
      {
        onStart: () => change.current.cancelPending?.(),
        onThreshold: () => api.sidebarAlignmentFeedback?.(),
      },
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
    // A new order moves the open page's panel in the DOM; follow it without sliding.
    if (slots.current !== order) {
      slots.current = order
      control.current?.place(slotOf(order, page))

      return
    }
    control.current?.go(slotOf(order, page))
  }, [page, order])

  return { viewport, track }
}
