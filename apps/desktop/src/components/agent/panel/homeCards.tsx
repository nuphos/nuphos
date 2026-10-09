import { CircleDot, GitPullRequest } from 'lucide-react'
import { useEffect, useState } from 'react'

import { api } from '../../../api'

import { GithubCardMenu } from './homeGithubMenu'
import { PullRows, RunRows } from './homeGithubRows'
import {
  PULL_STATUSES,
  RUN_STATUSES,
  filterPulls,
  filterRuns,
  mergeRepoReads,
  statusLabel,
} from './homeWidgetSettings'

import type { WithRepo } from './homeGithubRows'
import type { HomeGithubCard, HomeRepo } from './homeWidgetSettings'
import type { GithubPR, GithubWorkflowRun } from '../../../types'
import type { ReactNode } from 'react'

const REFRESH_MS = 60_000
const MAX_ROWS = 8

type RepoLoader<T> = (repo: HomeRepo, owner: string, name: string) => Promise<T[]>

async function loadTagged<T>(repo: HomeRepo, load: RepoLoader<T>): Promise<WithRepo<T>[]> {
  const [owner, name] = repo.fullName.split('/')
  const items = await load(repo, owner, name)

  return items.map((item) => ({
    ...item,
    repo: repo.fullName,
    installationId: repo.installationId,
  }))
}

/**
 * Loads one list per followed repository and merges them, refreshing every
 * minute. A repository whose read fails keeps its last rows and is listed in
 * `failed`, so the card can say what it could not check.
 */
function useRepoItems<T>(
  repos: HomeRepo[],
  load: RepoLoader<T>,
): { items: WithRepo<T>[] | null; failed: string[] } {
  const [state, setState] = useState<{
    byRepo: Map<string, WithRepo<T>[]>
    failed: string[]
  } | null>(null)
  const key = repos.map((r) => `${String(r.installationId)}/${r.fullName}`).join(',')

  useEffect(() => {
    if (!key) return
    let alive = true
    const refresh = () =>
      void Promise.allSettled(repos.map((repo) => loadTagged(repo, load))).then((results) => {
        if (!alive) return
        const reads = results.map((r, i) => ({
          repo: repos[i]?.fullName ?? '',
          items: r.status === 'fulfilled' ? r.value : null,
        }))

        setState((prev) => mergeRepoReads(prev?.byRepo ?? new Map(), reads))
      })

    refresh()
    const timer = setInterval(refresh, REFRESH_MS)

    return () => {
      alive = false
      clearInterval(timer)
    }
    // `key` captures the repository list; `load` only closes over the team id,
    // and a team switch remounts the widgets.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  return { items: state ? [...state.byRepo.values()].flat() : null, failed: state?.failed ?? [] }
}

function HomeCard({
  icon,
  title,
  menu,
  count,
  empty,
  failed,
  total,
  children,
}: {
  icon: ReactNode
  title: string
  /** Header controls, at the right end. */
  menu: ReactNode
  count: number | null
  empty: string
  /** Repositories whose latest read failed. */
  failed: string[]
  /** How many repositories the card follows. */
  total: number
  children: ReactNode
}) {
  let body = <div className="space-y-0.5">{children}</div>

  if (total === 0) {
    body = <div className="px-1 py-1.5 text-[12px] text-tertiary">Choose repositories from ⋯</div>
  } else if (count === null) {
    body = (
      <div className="space-y-1.5">
        {[0, 1].map((i) => (
          <div key={i} className="h-7 rounded-md bg-zGray-800/40 animate-pulse" />
        ))}
      </div>
    )
  } else if (count === 0 && failed.length === total) {
    // Nothing loaded at all: an empty list here would read as all clear.
    body = <div className="px-1 py-1.5 text-[12px] text-amber-400">Couldn't load from GitHub</div>
  } else if (count === 0) {
    body = <div className="px-1 py-1.5 text-[12px] text-tertiary">{empty}</div>
  }

  return (
    // A size container, so rows can show more when the card is wide.
    <section className="@container flex h-full min-w-0 flex-col rounded-lg border border-zGray-800/60 p-3">
      <div className="home-card-drag cursor-grab active:cursor-grabbing mb-2 flex items-center gap-1.5 px-1 text-[12px] text-secondary">
        {icon}
        <span className="truncate">{title}</span>
        {count !== null && total > 0 && <span className="text-tertiary tabular-nums">{count}</span>}
        {menu}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">{body}</div>
      {failed.length > 0 && failed.length < total && (
        <div className="truncate px-1 pt-1.5 text-[11px] text-amber-400" title={failed.join(', ')}>
          Couldn't check {failed.join(', ')}
        </div>
      )}
    </section>
  )
}

const loadPulls = (teamId: string) => (repo: HomeRepo, owner: string, name: string) =>
  api.atlasListGithubPulls(teamId, repo.installationId, owner, name, 'open')

const loadRuns =
  (teamId: string) =>
  async (repo: HomeRepo, owner: string, name: string): Promise<GithubWorkflowRun[]> =>
    (await api.atlasListGithubActionRuns(teamId, repo.installationId, owner, name, 1)).runs

/**
 * A pull request or CI card. Each follows its own repositories and shows one
 * status of them, both set from its ⋯ menu, so a team can keep, say, one
 * card of running CI for one repository and another of failures for another.
 */
export function GithubCard({
  teamId,
  card,
  onChange,
  onRemove,
  onOpenNuphosLink,
}: {
  teamId: string
  card: HomeGithubCard
  onChange: (card: HomeGithubCard) => void
  onOpenNuphosLink?: (href: string) => boolean
  onRemove: () => void
}) {
  const repoPath = (item: WithRepo<unknown>) =>
    `/teams/${encodeURIComponent(teamId)}/repository/installations/${String(item.installationId)}/repos/${item.repo.split('/').map(encodeURIComponent).join('/')}`
  const pulls = card.kind === 'pulls'
  // The status is applied while rendering, so changing it needs no reload.
  const { items, failed } = useRepoItems<GithubPR | GithubWorkflowRun>(
    card.repos,
    pulls ? loadPulls(teamId) : loadRuns(teamId),
  )
  // With several statuses, the empty message of the first one stands for all.
  const empty =
    (pulls ? PULL_STATUSES : RUN_STATUSES).find((s) =>
      (card.statuses as string[]).includes(s.value),
    )?.empty ?? ''
  let rows: ReactNode = null
  let count: number | null = null

  if (items && card.kind === 'pulls') {
    const shown = filterPulls(items as WithRepo<GithubPR>[], card.statuses).toSorted((a, b) =>
      b.updatedAt.localeCompare(a.updatedAt),
    ) as WithRepo<GithubPR>[]

    count = shown.length
    rows = (
      <PullRows
        pulls={shown.slice(0, MAX_ROWS)}
        onOpen={(pr) => {
          onOpenNuphosLink?.(`${repoPath(pr)}/pull-requests/${String(pr.number)}?state=all`)
        }}
      />
    )
  } else if (items && card.kind === 'ci') {
    const shown = filterRuns(items as WithRepo<GithubWorkflowRun>[], card.statuses).toSorted(
      (a, b) => b.createdAt.localeCompare(a.createdAt),
    ) as WithRepo<GithubWorkflowRun>[]

    count = shown.length
    rows = (
      <RunRows
        runs={shown.slice(0, MAX_ROWS)}
        onOpen={(run) => {
          onOpenNuphosLink?.(`${repoPath(run)}/workflows/${String(run.id)}`)
        }}
      />
    )
  }

  return (
    <HomeCard
      icon={
        pulls ? (
          <GitPullRequest className="h-3.5 w-3.5" strokeWidth={1.8} />
        ) : (
          <CircleDot className="h-3.5 w-3.5" strokeWidth={1.8} />
        )
      }
      title={`${pulls ? 'Pull requests' : 'CI'} · ${statusLabel(card)}`}
      menu={<GithubCardMenu teamId={teamId} card={card} onChange={onChange} onRemove={onRemove} />}
      count={count}
      empty={empty}
      failed={failed}
      total={card.repos.length}
    >
      {rows}
    </HomeCard>
  )
}
