import type { Tab } from './model.ts'

/** Keep unfinished sessions alive while another chat or Home is displayed. */
export function retainBackgroundTabs(tabs: Tab[], uploadingTabIds?: ReadonlySet<string>): Tab[] {
  return tabs.filter(
    (tab) => tab.streaming || Boolean(tab.queued?.length) || Boolean(uploadingTabIds?.has(tab.id)),
  )
}

/** Buffered SSE frames retain their original clock anchor across re-attachment. */
export function eventEmittedAt(event: Record<string, unknown>, fallback = Date.now()): number {
  return typeof event.emittedAt === 'number' ? event.emittedAt : fallback
}

export function statusElapsedSeconds(
  statusStartedAt: number | null,
  statusLabel: string | null,
  localClock: { status: string | null; startedAt: number | null },
  now: number,
): number | null {
  const startedAt =
    statusStartedAt ??
    (statusLabel && localClock.status === statusLabel ? localClock.startedAt : null)

  return startedAt === null ? null : Math.max(0, Math.floor((now - startedAt) / 1000))
}

/** An acknowledgement must not change the positional target of live events. */
export function acceptQueuedSteer(tab: Tab, queuedId: string): Tab {
  return { ...tab, queued: (tab.queued ?? []).filter((item) => item.id !== queuedId) }
}
