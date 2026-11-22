import clsx from 'clsx'
import { Plus } from 'lucide-react'
import { useRef } from 'react'

import { t } from '../../i18n'
import { SkeletonReveal } from '../SkeletonReveal'

import { BOTS_SECTION, foldKey, unpinnedChatItems } from './chat-sections'
import { SidebarSectionSkeleton } from './parts'
import { AddProjectButton } from './project-actions'
import { SidebarSectionList } from './sections-list'
import { SidebarBotPins } from './SidebarBotPins'
import { SidebarSectionHeading } from './SidebarSectionHeading'
import { taskPageSections } from './task-page-sections'
import { useTaskReflow } from './useTaskReflow'

import type { Item, Section } from './types'
import type { ComponentProps, UIEventHandler } from 'react'

export function SidebarPageList({
  page,
  sections,
  listProps,
  onScroll,
}: {
  page: 0 | 1
  sections: Section[]
  listProps: Omit<ComponentProps<typeof SidebarSectionList>, 'sections'>
  onScroll: UIEventHandler<HTMLElement>
}) {
  const taskList = useRef<HTMLElement | null>(null)

  useTaskReflow(taskList)
  const source = sections.filter((section) =>
    page === 0 ? section.title === 'Channels' : section.title === 'Tasks',
  )
  const shown =
    page === 1
      ? taskPageSections(source.flatMap((section) => section.items))
      : sections.filter((section) => section.title === 'Channels' || section.title === 'Favorites')
  // Only a Bot or chat pins; an older Task pin stays stored but is no Bot.
  const pinned = (item: Item) =>
    Boolean((item.bot || item.channel) && listProps.favoriteMatch(item))
  const visible = shown
    .filter((section) => section.title !== 'Tasks' || section.items.length > 0)
    .map((section) => ({
      ...section,
      ...(section.title === 'Tasks' || section.title === 'Channels' ? { title: undefined } : {}),
      ...(section.title === 'Channels' && {
        items: unpinnedChatItems(section.items, pinned),
      }),
    }))
  const loading = source.some((section) => section.loading)
  // Bots drops its title to hide its heading, so its row folds take back the Bots scope.
  const scoped = (fold: Pick<Section, 'title' | 'defaultCollapsed'>) =>
    page === 0 && fold.title?.startsWith('agent-session:')
      ? { ...fold, title: foldKey({ title: BOTS_SECTION }, fold.title) }
      : fold
  const props = {
    ...listProps,
    isGroupCollapsed: (section: Pick<Section, 'title' | 'defaultCollapsed'>) =>
      section.title === 'Tasks' || section.title === 'Channels'
        ? false
        : listProps.isGroupCollapsed(scoped(section)),
    toggleGroup: (section: Pick<Section, 'title' | 'defaultCollapsed'>) =>
      listProps.toggleGroup(scoped(section)),
  }
  const list = <SidebarSectionList {...props} sections={visible} />
  // The skeleton pulses until the first listing arrives, then cross-fades to the rows or the
  // empty message, so loading never reads as "nothing here".
  const content = (message: string, filled: boolean) => (
    <SkeletonReveal
      className="t-sidebar-section-reveal"
      ready={!loading}
      skeleton={<SidebarSectionSkeleton />}
    >
      {filled ? list : <p className="px-3 py-6 text-center text-[12px] text-tertiary">{message}</p>}
    </SkeletonReveal>
  )

  const heading: Section = {
    title: page === 0 ? 'Channels' : 'Tasks',
    items: [],
    nonCollapsible: true,
  }

  return (
    <div className="sidebar-page-layout flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center px-2.5 pb-1">
        <SidebarSectionHeading section={heading} collapsed={false} toggle={() => {}} />
        {page === 0 ? (
          source[0]?.action
        ) : (
          <div className="ml-auto flex items-center gap-1">
            <AddProjectButton teamId={listProps.scope.teamId} />
            <button
              title={t('New task')}
              aria-label={t('New task')}
              onClick={() => listProps.onSelect('team.agent')}
              className="flex size-7 items-center justify-center rounded-lg text-tertiary hover:bg-state-hover hover:text-main"
            >
              <Plus className="size-4" strokeWidth={1.8} />
            </button>
          </div>
        )}
      </div>
      <nav
        ref={taskList}
        onScroll={onScroll}
        className={clsx(
          'px-2.5 pb-2',
          'flex flex-col',
          'sidebar-page-list min-h-0 flex-1 overflow-y-auto overflow-x-hidden scrollbar-thin scrollbar-overlay',
        )}
      >
        {page === 0 ? (
          <SidebarBotPins
            bots={source.flatMap((section) => section.items)}
            order={listProps.botPins?.order}
            onPlace={listProps.botPins?.place}
            pinned={pinned}
            toggle={listProps.toggleFavorite}
            onItemMenu={listProps.onItemMenu}
            onSelect={listProps.onSelect}
            teamId={listProps.scope.teamId}
          >
            {content(
              t('No Bots yet'),
              source.some((section) => section.items.length > 0),
            )}
          </SidebarBotPins>
        ) : (
          <div className="shrink-0">
            {content(
              t('No tasks yet'),
              shown.some((section) => section.items.length > 0),
            )}
          </div>
        )}
      </nav>
    </div>
  )
}
