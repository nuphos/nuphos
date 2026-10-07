import type { GithubWorkflowRun } from '../../../types'
import type { HomeLayout, HomePanel, HomeRepo } from '../../../types/team.ts'

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
