import type { GithubWorkflowRun } from '../../../types'

/** A repository picked for a home card, addressed the way the GitHub API routes need it. */
export type HomeRepo = { installationId: number; fullName: string }

/** Which repositories each home card follows. A card with no repositories is hidden. */
export type HomeWidgetSettings = { pulls: HomeRepo[]; ci: HomeRepo[] }

export const EMPTY_HOME_WIDGETS: HomeWidgetSettings = { pulls: [], ci: [] }

// A personal layout choice, so it lives on this machine rather than the team.
const storageKey = (teamId: string) => `nuphos.agent.homeWidgets.${teamId}`

export function loadHomeWidgets(teamId: string): HomeWidgetSettings {
  try {
    const raw = localStorage.getItem(storageKey(teamId))

    if (!raw) return EMPTY_HOME_WIDGETS
    const parsed = JSON.parse(raw) as Partial<HomeWidgetSettings>

    return { pulls: parsed.pulls ?? [], ci: parsed.ci ?? [] }
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

export function toggleRepo(repos: HomeRepo[], repo: HomeRepo): HomeRepo[] {
  return repos.some((r) => r.fullName === repo.fullName)
    ? repos.filter((r) => r.fullName !== repo.fullName)
    : [...repos, repo]
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
