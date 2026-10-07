import type { GithubWorkflowRun } from '../../../types'
import type {
  HomeGridItem,
  HomeLayout,
  HomeLayouts,
  HomePanel,
  HomeRepo,
} from '../../../types/team.ts'

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

/**
 * The layout to show and edit, or null while it is unknown. Only a successful
 * read makes it known: editing from a stand-in would overwrite the real one.
 */
export function editableLayout(saved: HomeLayouts | null): HomeLayout | null {
  return saved ? (saved.personal ?? saved.team ?? EMPTY_HOME_LAYOUT) : null
}

export type RepoRead<T> = { repo: string; items: T[] | null }

/**
 * Folds one round of per-repository reads into what a card shows. A failed
 * read (`items: null`) keeps that repository's last good rows and is reported
 * in `failed`, so a card can say it could not check rather than look clean.
 */
export function mergeRepoReads<T>(
  prev: Map<string, T[]>,
  reads: RepoRead<T>[],
): { byRepo: Map<string, T[]>; failed: string[] } {
  const byRepo = new Map<string, T[]>()
  const failed: string[] = []

  for (const { repo, items } of reads) {
    if (items) {
      byRepo.set(repo, items)
    } else {
      failed.push(repo)
      const last = prev.get(repo)

      if (last) byRepo.set(repo, last)
    }
  }

  return { byRepo, failed }
}
