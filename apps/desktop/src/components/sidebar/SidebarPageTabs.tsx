import { MotionConfig, Reorder } from 'framer-motion'
import { useId, useRef, useState } from 'react'

import { api } from '../../api'
import { t } from '../../i18n'

import { moveTab, pageBeside, setSidebarTabOrder } from './sidebar-tab-order'
import { SidebarPageTab } from './SidebarPageTab'
import { SIDEBAR_PAGES } from './swipe-gesture'
import { useSidebarTabOrder } from './useSidebarMode'

import type { SidebarTabOrder } from './sidebar-tab-order'
import type { SidebarPage } from './swipe-gesture'
import type { KeyboardEvent } from 'react'

/**
 * Semantic mode switches, each with a visible count: unread Bots and Tasks, open questions on the Inbox.
 * Drag a tab (or Alt+Arrow) to reorder; the swipe pages and arrow keys follow the order.
 */
export function SidebarPageTabs({
  page,
  onPage,
  counts,
}: {
  page: SidebarPage
  onPage: (page: SidebarPage) => void
  /** Bots, Tasks and Inbox, in page order. */
  counts: readonly [number, number, number]
}) {
  const labels = [t('Bots'), t('Tasks'), t('Inbox')]
  const order = useSidebarTabOrder()
  const bounds = useRef<HTMLDivElement>(null)
  const hintId = useId()
  // While a drag is in flight the bar previews the order; it is saved on drop.
  const [preview, setPreview] = useState<SidebarTabOrder | null>(null)
  const dropping = useRef<SidebarTabOrder | null>(null)
  const [announcement, setAnnouncement] = useState('')
  const shown = preview ?? order
  const label = (id: SidebarPage) =>
    counts[id] > 0 ? `${labels[id]} · ${String(counts[id])}` : labels[id]
  const announce = (next: SidebarTabOrder, moved: SidebarPage) =>
    setAnnouncement(
      t('{tab} moved to position {position} of {total}', {
        tab: labels[moved],
        position: next.indexOf(moved) + 1,
        total: next.length,
      }),
    )
  const focus = (id: SidebarPage) =>
    document.getElementById(`sidebar-${SIDEBAR_PAGES[id]}-tab`)?.focus()

  const keyDown = (id: SidebarPage) => (event: KeyboardEvent<HTMLButtonElement>) => {
    const keys: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, Home: -9, End: 9 }

    if (!Object.hasOwn(keys, event.key)) return
    const delta = keys[event.key]

    event.preventDefault()
    if (event.altKey) {
      const next = moveTab(order, id, delta)

      if (next === order) return
      setSidebarTabOrder(next)
      announce(next, id)
      // The button keeps its DOM node, but re-focus in case the move blurred it.
      requestAnimationFrame(() => focus(id))

      return
    }
    const next = pageBeside(order, id, delta)

    onPage(next)
    focus(next)
  }

  return (
    <MotionConfig reducedMotion="user">
      <div
        className="sidebar-page-indicators flex shrink-0 justify-center titlebar-no-drag"
        role="tablist"
        aria-label={labels.join(' / ')}
      >
        <Reorder.Group
          ref={bounds}
          as="div"
          axis="x"
          role="presentation"
          values={shown as SidebarPage[]}
          onReorder={(next: SidebarPage[]) => {
            api.sidebarAlignmentFeedback?.()
            dropping.current = next
            setPreview(next)
          }}
          className="sidebar-page-tabs"
        >
          {shown.map((id) => (
            <SidebarPageTab
              key={SIDEBAR_PAGES[id]}
              page={id}
              label={label(id)}
              count={counts[id]}
              active={page === id}
              bounds={bounds}
              hintId={hintId}
              onSelect={() => onPage(id)}
              onKeyDown={keyDown(id)}
              onDrop={() => {
                const next = dropping.current

                dropping.current = null
                setPreview(null)
                if (!next) return
                setSidebarTabOrder(next)
                announce(next, id)
              }}
            />
          ))}
        </Reorder.Group>
        <span id={hintId} className="sr-only">
          {t('Press Alt and an arrow key to move this tab')}
        </span>
        <span role="status" aria-live="polite" className="sr-only">
          {announcement}
        </span>
      </div>
    </MotionConfig>
  )
}
