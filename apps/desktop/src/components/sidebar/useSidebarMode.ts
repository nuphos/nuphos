import { useCallback, useSyncExternalStore } from 'react'

import { setSidebarMode, sidebarMode, subscribeSidebarMode } from './sidebarModeStore'

import type { SidebarPage } from './swipe-gesture'

export function useSidebarMode(teamId: string, sessionId: string | null) {
  const page = useSyncExternalStore(subscribeSidebarMode, () =>
    sidebarMode(teamId, sessionId ? 1 : 0),
  )
  const change = useCallback((next: SidebarPage) => setSidebarMode(teamId, next), [teamId])

  return [page, change] as const
}
