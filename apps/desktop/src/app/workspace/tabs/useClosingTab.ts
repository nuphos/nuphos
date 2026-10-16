import { useLayoutEffect, useRef, useState } from 'react'

import type { WorkspaceTabsProps } from './tabsTypes'
import type { RefObject } from 'react'

type Tab = WorkspaceTabsProps['tabs'][number]

export type ClosingTab = { tab: Tab; index: number; width: number; selected: boolean }

/**
 * Every close path (the ×, Cmd+W, a terminal that exits) reaches the strip as
 * a tab missing from `tabs`. That tab keeps an inert copy in its old slot while
 * it collapses, so its neighbours slide over instead of jumping.
 */
export function useClosingTab(
  tabs: readonly Tab[],
  activeTabId: string | null | undefined,
  tabRefs: RefObject<Map<string, HTMLDivElement>>,
) {
  const [closingTab, setClosingTab] = useState<ClosingTab | null>(null)
  // What the strip showed last: by the time a close arrives, the tab is gone
  // from `tabs` and from the DOM, so its width is measured ahead of time.
  const shown = useRef({ tabs, activeTabId, widths: new Map<string, number>() })

  useLayoutEffect(() => {
    const before = shown.current
    const ids = new Set(tabs.map((tab) => tab.id))
    const removed = before.tabs.filter((tab) => !ids.has(tab.id))

    shown.current = {
      tabs,
      activeTabId,
      widths: new Map(tabs.map((tab) => [tab.id, tabRefs.current.get(tab.id)?.offsetWidth ?? 0])),
    }
    // Exactly one tab fewer is a close. Close others, a team switch or the
    // last tab being replaced by a fresh one just redraw.
    if (removed.length !== 1 || tabs.length !== before.tabs.length - 1) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const tab = removed[0]
    const width = before.widths.get(tab.id)

    if (!width) return
    // A second close inside the collapse replaces this copy (known, rarely visible at 120 ms).
    setClosingTab({
      tab,
      index: before.tabs.indexOf(tab),
      width,
      selected: tab.id === before.activeTabId,
    })
  }, [tabs, activeTabId, tabRefs])

  return [closingTab, () => setClosingTab(null)] as const
}
