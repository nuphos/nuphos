import { useLayoutEffect, useRef } from 'react'

import { api } from '../../api'

import { attachSidebarSwipe } from './sidebar-swipe-controller'

import type { SidebarPage, SidebarPageChange } from './swipe-gesture'

/** Track transforms are batched once per animation frame; React only sees committed pages. */
export function useSidebarSwipe(page: SidebarPage, onPage: SidebarPageChange) {
  const viewport = useRef<HTMLDivElement>(null)
  const track = useRef<HTMLDivElement>(null)
  const change = useRef(onPage)
  const control = useRef<{ go: (page: SidebarPage) => void } | null>(null)

  useLayoutEffect(() => {
    change.current = onPage
  }, [onPage])

  useLayoutEffect(() => {
    const el = viewport.current
    const layer = track.current

    if (!el || !layer) return
    const controller = attachSidebarSwipe(el, layer, page, (next) => change.current(next), {
      onStart: () => change.current.cancelPending?.(),
      onThreshold: () => api.sidebarAlignmentFeedback?.(),
    })
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
    control.current?.go(page)
  }, [page])

  return { viewport, track }
}
