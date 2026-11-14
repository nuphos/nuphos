import { SidebarInboxPage } from './SidebarInboxPage'
import { SidebarPageList } from './SidebarPageList'
import { SidebarPageTabs } from './SidebarPageTabs'
import { SidebarSwipePages } from './SidebarSwipePages'
import { useInboxBadge } from './use-inbox-badge'
import { useSidebarModeNavigation } from './useSidebarModeNavigation'

import type { SidebarSectionList } from './sections-list'
import type { SidebarPage } from './swipe-gesture'
import type { Section } from './types'
import type { ComponentProps, UIEventHandler } from 'react'

export function SidebarTeamPages({
  page,
  onPage,
  sections,
  listProps,
  onScroll,
}: {
  page: SidebarPage
  onPage: (page: SidebarPage) => void
  sections: Section[]
  listProps: Omit<ComponentProps<typeof SidebarSectionList>, 'sections'>
  onScroll: UIEventHandler<HTMLElement>
}) {
  // An open question counts on the Inbox alone, not again on the Bot or Task that asked.
  const count = sections
    .flatMap((section) => (section.title === 'Tasks' ? section.items : []))
    .filter(
      (item) => item.task && !item.bot && item.taskState === 'attention' && item.dot !== 'waiting',
    ).length
  const botCount = new Set(
    sections
      .flatMap((section) => (section.title === 'Channels' ? section.items : []))
      .filter((item) => item.channel && !item.botNested && item.unread && item.dot !== 'waiting')
      .map((item) => item.key),
  ).size
  const inboxCount = useInboxBadge(listProps.scope.teamId)
  const changePage = useSidebarModeNavigation(onPage, sections, listProps)
  const content = (index: 0 | 1) => (
    <SidebarPageList page={index} sections={sections} listProps={listProps} onScroll={onScroll} />
  )

  return (
    <div data-mode-pages className="flex min-h-0 flex-1 flex-col">
      <SidebarSwipePages
        page={page}
        onPage={changePage}
        pages={[
          content(0),
          content(1),
          <SidebarInboxPage
            teamId={listProps.scope.teamId}
            onOpenInbox={() => changePage(2)}
            onScroll={onScroll}
          />,
        ]}
      />
      <div className="sidebar-mode-switcher">
        <SidebarPageTabs page={page} onPage={changePage} counts={[botCount, count, inboxCount]} />
      </div>
    </div>
  )
}
