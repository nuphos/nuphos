import { useCallback, useSyncExternalStore } from 'react'

import { defaultPage, sidebarTabOrder, subscribeSidebarTabOrder } from './sidebar-tab-order'
import { setSidebarMode, sidebarMode, subscribeSidebarMode } from './sidebarModeStore'

import type { SidebarPage } from './swipe-gesture'

export function useSidebarTabOrder() {
  return useSyncExternalStore(subscribeSidebarTabOrder, sidebarTabOrder, sidebarTabOrder)
}

export function useSidebarMode(teamId: string, sessionId: string | null) {
  const order = useSidebarTabOrder()
  const page = useSyncExternalStore(subscribeSidebarMode, () =>
    sidebarMode(teamId, sessionId ? 1 : defaultPage(order)),
  )
  const change = useCallback((next: SidebarPage) => setSidebarMode(teamId, next), [teamId])

  return [page, change] as const
}
