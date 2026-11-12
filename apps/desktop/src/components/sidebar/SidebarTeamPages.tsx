import { SidebarPageList } from './SidebarPageList'
import { SidebarPageTabs } from './SidebarPageTabs'
import { SidebarSwipePages } from './SidebarSwipePages'
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
  const count = sections
    .flatMap((section) => (section.title === 'Tasks' ? section.items : []))
    .filter((item) => item.task && !item.bot && item.taskState === 'attention').length
  const changePage = useSidebarModeNavigation(onPage, sections, listProps)
  const content = (index: 0 | 1) => (
    <SidebarPageList page={index} sections={sections} listProps={listProps} onScroll={onScroll} />
  )

  return (
    <div data-mode-pages className="flex min-h-0 flex-1 flex-col">
      <SidebarSwipePages page={page} onPage={changePage} bots={content(0)} tasks={content(1)} />
      <div className="sidebar-mode-switcher">
        <SidebarPageTabs page={page} onPage={changePage} count={count} />
      </div>
    </div>
  )
}
