import type { GithubWorkflowRun } from '../../../types'

/** A repository picked for a home card, addressed the way the GitHub API routes need it. */
export type HomeRepo = { installationId: number; fullName: string }

/** A Nuphos Dashboards panel pinned to the home page. */
export type HomePanel = { dashboardId: string; panelId: string }

/**
 * What the home page shows: the team activity card, the repositories each
 * GitHub card follows (a card with none is hidden) and the dashboard panels
 * pinned as cards of their own.
 */
export type HomeWidgetSettings = {
  team: boolean
  pulls: HomeRepo[]
  ci: HomeRepo[]
  panels: HomePanel[]
}

export const EMPTY_HOME_WIDGETS: HomeWidgetSettings = { team: false, pulls: [], ci: [], panels: [] }

export const repoKey = (repo: HomeRepo) => repo.fullName
export const panelKey = (panel: HomePanel) => `${panel.dashboardId}/${panel.panelId}`

// A personal layout choice, so it lives on this machine rather than the team.
const storageKey = (teamId: string) => `nuphos.agent.homeWidgets.${teamId}`

export function loadHomeWidgets(teamId: string): HomeWidgetSettings {
  try {
    const raw = localStorage.getItem(storageKey(teamId))

    if (!raw) return EMPTY_HOME_WIDGETS
    const parsed = JSON.parse(raw) as Partial<HomeWidgetSettings>

    return {
      team: parsed.team ?? false,
      pulls: parsed.pulls ?? [],
      ci: parsed.ci ?? [],
      panels: parsed.panels ?? [],
    }
  } catch {
    return EMPTY_HOME_WIDGETS
  }
}

export function saveHomeWidgets(teamId: string, settings: HomeWidgetSettings): void {
  try {
    localStorage.setItem(storageKey(teamId), JSON.stringify(settings))
  } catch {
    // Storage unavailable — the choice just won't survive a relaunch.
  }
}

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
