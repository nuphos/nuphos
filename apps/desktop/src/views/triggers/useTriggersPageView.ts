import { useState } from 'react'

import { useResetOnKey } from '../useResetOnKey'

export type TriggersPageView = 'list' | 'calendar'

export const PAGE_VIEWS: { value: TriggersPageView; label: string }[] = [
  { value: 'list', label: 'List' },
  { value: 'calendar', label: 'Calendar' },
]
const PAGE_VIEW_STORAGE_KEY = 'nuphos.triggersPageView'

function loadPageView(): TriggersPageView {
  try {
    return localStorage.getItem(PAGE_VIEW_STORAGE_KEY) === 'calendar' ? 'calendar' : 'list'
  } catch {
    return 'list'
  }
}

/** List or Calendar: the viewer's last choice, unless `initialView` asks for one. */
export function useTriggersPageView(initialView: TriggersPageView | undefined) {
  const [pageView, setPageView] = useState<TriggersPageView>(() => initialView ?? loadPageView())

  useResetOnKey(initialView ?? '', () => {
    setPageView(initialView ?? loadPageView())
  })
  const changePageView = (next: TriggersPageView) => {
    setPageView(next)
    try {
      localStorage.setItem(PAGE_VIEW_STORAGE_KEY, next)
    } catch {
      // Best-effort persistence only.
    }
  }

  return [pageView, changePageView] as const
}
