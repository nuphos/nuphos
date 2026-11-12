import { useCallback, useEffect, useState } from 'react'

import { sidebarActivation } from './sidebarActivation'
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
  const [activation] = useState(sidebarActivation)

  useEffect(() => () => activation.cancel(), [activation])
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

  const changePage = useCallback(
    (next: SidebarPage) => {
      onPage(next)
      const mode = next === 0 ? 1 : 2
      const target = restoreModeItem(next === 0 ? bots : tasks, readModeSelection(teamId, mode))

      if (!target) {
        activation.cancel()
        if (list.active !== 'team.agent') list.onSelect('team.agent')

        return
      }
      rememberModeSelection(teamId, mode, target)
      activation.schedule(target.active ? target.key : list.active, target.key, () => {
        if (target.onActivate) target.onActivate(false)
        else list.onSelect(target.key)
      })
    },
    [onPage, list, bots, tasks, teamId, activation],
  )

  return Object.assign(changePage, { cancelPending: () => activation.cancel() })
}
