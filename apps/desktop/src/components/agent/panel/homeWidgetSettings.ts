import type { GithubWorkflowRun } from '../../../types'
import type { HomeGridItem, HomeLayout, HomePanel, HomeRepo } from '../../../types/team.ts'

export type { HomeLayout, HomePanel, HomeRepo } from '../../../types/team.ts'

export const EMPTY_HOME_LAYOUT: HomeLayout = { team: false, pulls: [], ci: [], panels: [] }

export const repoKey = (repo: HomeRepo) => repo.fullName
export const panelKey = (panel: HomePanel) => `${panel.dashboardId}/${panel.panelId}`

/** Adds `item` when no entry shares its key, otherwise removes that entry. */
export function toggleItem<T>(list: T[], item: T, key: (t: T) => string): T[] {
  const k = key(item)

  return list.some((t) => key(t) === k) ? list.filter((t) => key(t) !== k) : [...list, item]
}

/**
 * Runs that are failing right now: the latest run of each workflow on each
 * branch, kept only when it failed. A failure already followed by a newer run
 * of the same workflow on the same branch is history, not something to fix.
 */
export function failingRuns(runs: GithubWorkflowRun[]): GithubWorkflowRun[] {
  const latest = new Map<string, GithubWorkflowRun>()

  for (const run of runs) {
    const key = `${run.name}\u0000${run.headBranch}`
    const seen = latest.get(key)

    if (!seen || run.createdAt > seen.createdAt) latest.set(key, run)
  }

  return [...latest.values()].filter((run) => run.conclusion === 'failure')
}

export const GRID_COLUMNS = 12

/** A new card's size: the heatmap gets the full row, the rest half of it. */
function defaultSize(key: string): { w: number; h: number } {
  if (key === 'team') return { w: GRID_COLUMNS, h: 8 }
  if (key.startsWith('panel:')) return { w: GRID_COLUMNS / 2, h: 6 }

  return { w: GRID_COLUMNS / 2, h: 7 }
}

/**
 * The grid for the cards on show, in order: a card keeps its saved place and
 * size, and one without (newly added) goes below everything else. Saved
 * entries for cards no longer on show are dropped.
 */
export function gridFor(keys: string[], saved: HomeGridItem[] = []): HomeGridItem[] {
  const byKey = new Map(saved.map((item) => [item.i, item]))
  let bottom = Math.max(
    0,
    ...keys.map((k) => byKey.get(k)).map((item) => (item ? item.y + item.h : 0)),
  )

  return keys.map((i) => {
    const item = byKey.get(i)

    if (item) return item
    const size = defaultSize(i)
    const placed = { i, x: 0, y: bottom, ...size }

    bottom += size.h

    return placed
  })
}
