import { api } from '../../../api'

import { starterLayout } from './homeWidgetSettings'

import type { HomeLayout, HomePanel, HomeRepo } from './homeWidgetSettings'

// Panels a starter layout pins at most, so a large first dashboard does not
// bury the rest of the page.
const MAX_STARTER_PANELS = 4

/** The repository pushed to most recently, across the team's GitHub installations. */
async function latestRepo(teamId: string): Promise<HomeRepo | null> {
  const installations = await api.atlasListGithubInstallations(teamId)
  const lists = await Promise.allSettled(
    installations.map(async (inst) =>
      (await api.atlasListGithubRepositories(teamId, inst.installationId)).map((r) => ({
        repo: { installationId: inst.installationId, fullName: r.fullName },
        pushedAt: r.archived ? '' : (r.pushedAt ?? ''),
      })),
    ),
  )
  const repos = lists.flatMap((l) => (l.status === 'fulfilled' ? l.value : []))
  const latest = repos.reduce<(typeof repos)[number] | null>(
    (best, r) => (r.pushedAt && (!best || r.pushedAt > best.pushedAt) ? r : best),
    null,
  )

  return latest?.repo ?? null
}

async function repoActivity(teamId: string, repo: HomeRepo) {
  const [owner = '', name = ''] = repo.fullName.split('/')
  const [pulls, runs] = await Promise.allSettled([
    api.atlasListGithubPulls(teamId, repo.installationId, owner, name, 'open'),
    api.atlasListGithubActionRuns(teamId, repo.installationId, owner, name, 1),
  ])

  return {
    hasPulls: pulls.status === 'fulfilled' && pulls.value.length > 0,
    hasRuns: runs.status === 'fulfilled' && runs.value.runs.length > 0,
  }
}

/** Panels of the team's first dashboard that already have a result to show. */
async function firstDashboardPanels(teamId: string): Promise<HomePanel[]> {
  const dashboards = await api.dashboardsList(teamId)
  const first = dashboards.toSorted((a, b) => a.createdAt.localeCompare(b.createdAt))[0]

  if (!first) return []
  const detail = await api.dashboardsGet(teamId, first.id)

  return detail.panels
    .filter((p) => p.lastSuccessfulSnapshot?.output ?? p.currentSnapshot?.output)
    .slice(0, MAX_STARTER_PANELS)
    .map((p) => ({ dashboardId: first.id, panelId: p.id }))
}

// Short enough that binding GitHub or creating a dashboard shows up the next
// time home opens, long enough that moving around the app does not refetch.
const CACHE_MS = 60_000
const cache = new Map<string, { at: number; result: Promise<HomeLayout> }>()

/**
 * The layout a member sees before anyone has saved one: the activity heatmap,
 * plus, once the team has them, pull request and CI cards for its most
 * recently pushed repository and the panels of its first dashboard, so a new
 * team discovers what the home page can hold. Each part is best effort; one
 * that fails to load is simply left out.
 */
export function loadStarterLayout(teamId: string): Promise<HomeLayout> {
  const hit = cache.get(teamId)

  if (hit && Date.now() - hit.at < CACHE_MS) return hit.result
  const result = (async () => {
    const [repo, panels] = await Promise.all([
      latestRepo(teamId).catch(() => null),
      firstDashboardPanels(teamId).catch(() => []),
    ])
    const activity = repo ? await repoActivity(teamId, repo) : { hasPulls: false, hasRuns: false }

    return starterLayout({ repo, ...activity, panels })
  })()

  cache.set(teamId, { at: Date.now(), result })

  return result
}
