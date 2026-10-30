import { t } from '../../../i18n/index.ts'

import { GRID_COLUMNS, cardKind, catalogEntry } from './homeCardCatalog.ts'
import { metricSize } from './homeMetricFormat.ts'

import type { GithubPR, GithubWorkflowRun } from '../../../types'
import type {
  HomeMetricCard,
  HomeMetricKind,
  HomeGithubCard,
  HomeGridItem,
  HomeLayout,
  HomeLayouts,
  HomePanel,
  HomePullStatus,
  HomeRepo,
  HomeRunStatus,
} from '../../../types/team.ts'

export type {
  HomeGithubCard,
  HomeLayout,
  HomeMetricCard,
  HomePanel,
  HomeRepo,
} from '../../../types/team.ts'

export { GRID_COLUMNS } from './homeCardCatalog.ts'

/** What a team starts with: just the activity heatmap. */
export const DEFAULT_HOME_LAYOUT: HomeLayout = { team: true, github: [], panels: [], metrics: [] }

/**
 * The default plus what a team already has to show: pull request and CI cards
 * for `repo` when it has open pull requests or runs, and `panels` from the
 * first dashboard.
 */
export function starterLayout({
  repo,
  hasPulls,
  hasRuns,
  panels,
}: {
  repo: HomeRepo | null
  hasPulls: boolean
  hasRuns: boolean
  panels: HomePanel[]
}): HomeLayout {
  const github: HomeLayout['github'] = []

  if (repo && hasPulls) {
    github.push({ id: 'starter-pulls', kind: 'pulls', repos: [repo], statuses: ['open'] })
  }
  if (repo && hasRuns) {
    github.push({ id: 'starter-ci', kind: 'ci', repos: [repo], statuses: ['latest'] })
  }

  return { ...DEFAULT_HOME_LAYOUT, github, panels }
}

export const repoKey = (repo: HomeRepo) => repo.fullName
export const panelKey = (panel: HomePanel) => `${panel.dashboardId}/${panel.panelId}`
/** A metric card's grid key; the kind is in it so its size and name are known before it loads. */
export const metricKey = (card: HomeMetricCard) => `metric:${card.kind}:${card.id}`
const metricKind = (key: string) => key.split(':')[1] as HomeMetricKind

/** Adds `item` when no entry shares its key, otherwise removes that entry. */
export function toggleItem<T>(list: T[], item: T, key: (t: T) => string): T[] {
  const k = key(item)

  return list.some((t) => key(t) === k) ? list.filter((t) => key(t) !== k) : [...list, item]
}

export const PULL_STATUSES: { value: HomePullStatus; label: string; empty: string }[] = [
  { value: 'open', label: t('Open|state'), empty: t('No open pull requests') },
  { value: 'ready', label: t('Ready for review'), empty: t('Nothing ready for review') },
  { value: 'draft', label: t('Draft'), empty: t('No drafts') },
]

export const RUN_STATUSES: { value: HomeRunStatus; label: string; empty: string }[] = [
  { value: 'failed', label: t('Failing'), empty: t('Nothing failing') },
  { value: 'running', label: t('Running'), empty: t('Nothing running') },
  { value: 'latest', label: t('Latest'), empty: t('No runs yet') },
]

/** A card's statuses as their labels, in menu order, e.g. "Failing, Running". */
export function statusLabel(card: HomeGithubCard): string {
  const all: { value: string; label: string }[] =
    card.kind === 'pulls' ? PULL_STATUSES : RUN_STATUSES
  const chosen = card.statuses as string[]

  return all
    .filter((s) => chosen.includes(s.value))
    .map((s) => s.label)
    .join(', ')
}

/** A pull request or CI card's title, e.g. "CI · Failing". */
export function githubCardTitle(card: HomeGithubCard): string {
  return `${card.kind === 'pulls' ? t('Pull requests') : 'CI'} · ${statusLabel(card)}`
}

/** Pull requests in any of `statuses`; `open` takes them all. */
export function filterPulls(pulls: GithubPR[], statuses: HomePullStatus[]): GithubPR[] {
  if (statuses.includes('open')) return pulls

  return pulls.filter((pr) => statuses.includes(pr.draft ? 'draft' : 'ready'))
}

/**
 * The runs a CI card shows. Only the latest run of each workflow on each
 * branch counts: a failure already followed by a newer run is history. Of
 * those, a run shows when it matches any of `statuses`: `failed` for
 * failures, `running` for ones still in progress or queued, `latest` for all.
 */
export function filterRuns(
  runs: GithubWorkflowRun[],
  statuses: HomeRunStatus[],
): GithubWorkflowRun[] {
  const latest = new Map<string, GithubWorkflowRun>()

  for (const run of runs) {
    const key = `${run.name}\u0000${run.headBranch}`
    const seen = latest.get(key)

    if (!seen || run.createdAt > seen.createdAt) latest.set(key, run)
  }

  return [...latest.values()].filter(
    (run) =>
      statuses.includes('latest') ||
      (statuses.includes('failed') && run.conclusion === 'failure') ||
      (statuses.includes('running') && run.status !== 'completed'),
  )
}

/**
 * A new card's size, from its kind: the heatmap gets the full row, the rest
 * half of it. A key of no known kind sizes as a GitHub card.
 */
function defaultSize(key: string): { w: number; h: number } {
  return catalogEntry(cardKind(key) ?? 'pulls').size
}

/**
 * The smallest a card may be resized to: room for its header and at least one
 * row, so its content scrolls inside it instead of spilling onto the card below.
 */
export function minCardSize(key: string): { minW: number; minH: number } {
  if (key === 'team') return { minW: GRID_COLUMNS / 2, minH: 4 }
  // A metric card needs room for its title, number and the lines under it.
  if (key.startsWith('metric:')) return { minW: 4, minH: metricSize(metricKind(key)).h }

  return { minW: 3, minH: 3 }
}

export const overlaps = (a: HomeGridItem, b: HomeGridItem) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

/**
 * The grid for the cards on show, in order: a card keeps its saved place and
 * size, and one without (newly added) takes the first free spot that fits it,
 * row by row — beside a half-width card when there is room, below otherwise.
 * Saved entries for cards no longer on show are dropped, and a saved size below
 * the card's minimum grows back to it.
 */
export function gridFor(keys: string[], saved: HomeGridItem[] = []): HomeGridItem[] {
  const byKey = new Map(
    saved.map((item) => {
      const { minW, minH } = minCardSize(item.i)

      return [item.i, { ...item, w: Math.max(item.w, minW), h: Math.max(item.h, minH) }]
    }),
  )
  const taken = keys.flatMap((k) => byKey.get(k) ?? [])

  return keys.map((i) => {
    const item = byKey.get(i)

    if (item) return item
    const size = defaultSize(i)

    for (let y = 0; ; y++) {
      for (let x = 0; x + size.w <= GRID_COLUMNS; x++) {
        const spot = { i, x, y, ...size }

        if (!taken.some((other) => overlaps(other, spot))) {
          taken.push(spot)

          return spot
        }
      }
    }
  })
}

/** A card's title from its grid key, as screen readers hear it when it moves. */
export function cardLabel(layout: HomeLayout, key: string): string {
  const github = layout.github.find((card) => `gh:${card.id}` === key)

  if (github) return githubCardTitle(github)
  const kind = cardKind(key, layout)

  return kind ? catalogEntry(kind).title : key
}

/**
 * The layout to show and edit, or null while it is unknown. Only a successful
 * read makes it known: editing from a stand-in would overwrite the real one.
 */
export function editableLayout(
  saved: HomeLayouts | null,
  fallback: HomeLayout = DEFAULT_HOME_LAYOUT,
): HomeLayout | null {
  if (!saved) return null
  const layout = saved.personal ?? saved.team ?? fallback

  // Layouts saved before a field existed read as without it.
  return {
    ...DEFAULT_HOME_LAYOUT,
    ...layout,
    github: layout.github ?? [],
    panels: layout.panels ?? [],
    metrics: layout.metrics ?? [],
  }
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
