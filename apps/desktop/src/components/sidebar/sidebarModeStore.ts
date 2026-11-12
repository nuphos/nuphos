import type { SidebarPage } from './swipe-gesture'

const modes = new Map<string, SidebarPage>()
const listeners = new Set<() => void>()
const key = (teamId: string) => `nuphos.sidebar.mode.v2.${teamId}`

export function sidebarMode(teamId: string, fallback: SidebarPage): SidebarPage {
  const current = modes.get(teamId)

  if (current !== undefined) return current
  let page = fallback

  try {
    const saved = localStorage.getItem(key(teamId))

    if (saved === '0' || saved === '1') page = Number(saved) as SidebarPage
  } catch {
    /* Storage is optional. */
  }
  modes.set(teamId, page)

  return page
}

export function setSidebarMode(teamId: string, page: SidebarPage) {
  modes.set(teamId, page)
  try {
    localStorage.setItem(key(teamId), String(page))
  } catch {
    /* Storage is optional. */
  }
  for (const listener of listeners) listener()
}

export function subscribeSidebarMode(listener: () => void) {
  listeners.add(listener)

  return () => {
    listeners.delete(listener)
  }
}
