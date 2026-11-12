import type { Tab } from './model.ts'

/** Keep unfinished sessions alive while another chat or Home is displayed. */
export function retainBackgroundTabs(tabs: Tab[], uploadingTabIds?: ReadonlySet<string>): Tab[] {
  return tabs.filter(
    (tab) => tab.streaming || Boolean(tab.queued?.length) || Boolean(uploadingTabIds?.has(tab.id)),
  )
}

/** Keep two recent settled conversations warm, without evicting live work. */
export function retainOpenedTabs(tabs: Tab[], uploadingTabIds?: ReadonlySet<string>): Tab[] {
  const live = new Set(retainBackgroundTabs(tabs, uploadingTabIds))
  const recent = new Set(tabs.filter((tab) => !live.has(tab)).slice(-2))

  return tabs.filter((tab) => live.has(tab) || recent.has(tab))
}

/** Move an activated chat to the recent end without replacing its state. */
export function touchOpenedTab(tabs: Tab[], id: string): Tab[] {
  const tab = tabs.find((candidate) => candidate.id === id)

  return tab ? [...tabs.filter((candidate) => candidate.id !== id), tab] : tabs
}

/** Buffered SSE frames retain their original clock anchor across re-attachment. */
export function eventEmittedAt(event: Record<string, unknown>, fallback = Date.now()): number {
  return typeof event.emittedAt === 'number' ? event.emittedAt : fallback
}

/** An acknowledgement must not change the positional target of live events. */
export function acceptQueuedSteer(tab: Tab, queuedId: string): Tab {
  return { ...tab, queued: (tab.queued ?? []).filter((item) => item.id !== queuedId) }
}
