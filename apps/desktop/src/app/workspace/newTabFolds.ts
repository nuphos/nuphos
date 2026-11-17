import { useMemo, useSyncExternalStore } from 'react'

import {
  loadGroupState,
  readGroupStateRaw,
  subscribeGroupState,
  writeGroupFold,
} from '../../components/sidebar/state.ts'

import type { GroupState } from '../../components/sidebar/state.ts'

export type FoldGroup = { key: string; defaultCollapsed?: boolean }

// New tab folds share the sidebar's per-team store under their own prefix, so
// a New tab group and a sidebar group with the same title never collide.
const foldKey = (group: FoldGroup) => `newtab:${group.key}`

export function isNewTabGroupCollapsed(state: GroupState, group: FoldGroup): boolean {
  return (state[foldKey(group)] ?? (group.defaultCollapsed ? 'closed' : 'open')) === 'closed'
}

export function toggleNewTabGroup(teamId: string, group: FoldGroup): void {
  writeGroupFold(
    teamId,
    foldKey(group),
    isNewTabGroupCollapsed(loadGroupState(teamId), group) ? 'open' : 'closed',
  )
}

/** The rows arrow keys move through: every row of every unfolded group, in order. */
export function browsableOptions<T>(
  groups: (FoldGroup & { options: T[] })[],
  isCollapsed: (group: FoldGroup) => boolean,
): T[] {
  return groups.flatMap((group) => (isCollapsed(group) ? [] : group.options))
}

export function useNewTabFolds(teamId: string) {
  const raw = useSyncExternalStore(subscribeGroupState, readGroupStateRaw, () => null)
  const state = useMemo(() => loadGroupState(teamId, raw), [teamId, raw])

  return {
    isCollapsed: (group: FoldGroup) => isNewTabGroupCollapsed(state, group),
    toggle: (group: FoldGroup) => toggleNewTabGroup(teamId, group),
  }
}
