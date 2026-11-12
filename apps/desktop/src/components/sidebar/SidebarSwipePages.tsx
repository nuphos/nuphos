import './sidebar-pages.css'

import { useSidebarSwipe } from './useSidebarSwipe'

import type { SidebarPage, SidebarPageChange } from './swipe-gesture'
import type { ReactNode } from 'react'

export function SidebarSwipePages({
  page,
  onPage,
  bots,
  tasks,
}: {
  page: SidebarPage
  onPage: SidebarPageChange
  bots: ReactNode
  tasks: ReactNode
}) {
  const { viewport, track } = useSidebarSwipe(page, onPage)

  return (
    <div ref={viewport} className="sidebar-swipe-viewport min-h-0 flex-1">
      <div ref={track} className="sidebar-swipe-track">
        {[
          { id: 'bots', content: bots },
          { id: 'tasks', content: tasks },
        ].map(({ id, content }, index) => (
          <div
            key={id}
            id={`sidebar-${id}-page`}
            role="tabpanel"
            aria-labelledby={`sidebar-${id}-tab`}
            inert={page !== index}
            className="sidebar-swipe-page"
          >
            {content}
          </div>
        ))}
      </div>
    </div>
  )
}
