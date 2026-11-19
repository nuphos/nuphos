import { useCallback, useEffect } from 'react'

import {
  modeItems,
  readModeSelection,
  rememberModeSelection,
  restoreModeItem,
} from './sidebarSelection'

import type { SidebarSectionList } from './sections-list'
import type { SidebarPage } from './swipe-gesture'
import type { Section } from './types'
import type { ComponentProps } from 'react'

type ListProps = Omit<ComponentProps<typeof SidebarSectionList>, 'sections'>

export function useSidebarModeNavigation(
  onPage: (page: SidebarPage) => void,
  sections: Section[],
  list: ListProps,
) {
  const teamId = list.scope.teamId
  const bots = modeItems(sections, 1)
  const tasks = modeItems(sections, 2)
  const selectedBot = bots.find((item) => item.active || item.key === list.active)
  const selectedTask = tasks.find((item) => item.active || item.key === list.active)

  useEffect(() => {
    if (selectedBot) rememberModeSelection(teamId, 1, selectedBot)
  }, [teamId, selectedBot])
  useEffect(() => {
    if (selectedTask) rememberModeSelection(teamId, 2, selectedTask)
  }, [teamId, selectedTask])

  // The page and what it opens change in one event, so they render together: the main pane
  // never shows the page with nothing selected (Bots' New Bot page) in between.
  return useCallback(
    (next: SidebarPage) => {
      onPage(next)
      if (next === 2) {
        if (list.active !== 'team.inbox') list.onSelect('team.inbox')

        return
      }
      const mode = next === 0 ? 1 : 2
      const target = restoreModeItem(next === 0 ? bots : tasks, readModeSelection(teamId, mode))

      if (!target) {
        if (list.active !== 'team.agent') list.onSelect('team.agent')

        return
      }
      rememberModeSelection(teamId, mode, target)
      // Never reopen the conversation already shown.
      if (target.active || list.active === target.key) return
      if (target.onActivate) target.onActivate(false)
      else list.onSelect(target.key)
    },
    [onPage, list, bots, tasks, teamId],
  )
}
