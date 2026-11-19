import './sidebar-pages.css'

import { SIDEBAR_PAGES } from './swipe-gesture'
import { useSidebarTabOrder } from './useSidebarMode'
import { useSidebarSwipe } from './useSidebarSwipe'

import type { SidebarPage, SidebarPageChange } from './swipe-gesture'
import type { ReactNode } from 'react'

export function SidebarSwipePages({
  page,
  onPage,
  pages,
}: {
  page: SidebarPage
  onPage: SidebarPageChange
  /** Bots, Tasks and Inbox, in page order. */
  pages: readonly [ReactNode, ReactNode, ReactNode]
}) {
  const order = useSidebarTabOrder()
  const { viewport, track } = useSidebarSwipe(page, onPage, order)

  return (
    <div ref={viewport} className="sidebar-swipe-viewport min-h-0 flex-1">
      <div ref={track} className="sidebar-swipe-track">
        {/* Flex `order` places panels as the tabs are ordered, so a reorder never moves them in the DOM. */}
        {SIDEBAR_PAGES.map((id, index) => (
          <div
            key={id}
            id={`sidebar-${id}-page`}
            role="tabpanel"
            aria-labelledby={`sidebar-${id}-tab`}
            inert={page !== index}
            className="sidebar-swipe-page"
            style={{ order: order.indexOf(index as SidebarPage) }}
          >
            {pages[index]}
          </div>
        ))}
      </div>
    </div>
  )
}
