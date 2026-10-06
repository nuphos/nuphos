import { Button as BaseButton } from '@base-ui/react/button'
import { CircleX, GitPullRequest, GitPullRequestDraft } from 'lucide-react'
import { useEffect, useState } from 'react'

import { api } from '../../../api'
import { formatAge } from '../../../utils'
import { openOnGithub } from '../../../views/github-repo/openOnGithub'

import { failingRuns } from './homeWidgets'

import type { HomeRepo } from './homeWidgets'
import type { ReactNode } from 'react'

const REFRESH_MS = 60_000
const MAX_ROWS = 8

type WithRepo<T> = T & { repo: string }
type RepoLoader<T> = (repo: HomeRepo, owner: string, name: string) => Promise<T[]>

async function loadTagged<T>(repo: HomeRepo, load: RepoLoader<T>): Promise<WithRepo<T>[]> {
  const [owner, name] = repo.fullName.split('/')
  const items = await load(repo, owner, name)

  return items.map((item) => ({ ...item, repo: repo.fullName }))
}

/**
 * Loads one list per followed repository and merges them, refreshing every
 * minute. A repository that fails to load is left out rather than failing
 * the card — the rest still tells the user something.
 */
function useRepoItems<T>(repos: HomeRepo[], load: RepoLoader<T>): WithRepo<T>[] | null {
  const [items, setItems] = useState<WithRepo<T>[] | null>(null)
  const key = repos.map((r) => `${String(r.installationId)}/${r.fullName}`).join(',')

  useEffect(() => {
    if (!key) return
    let alive = true
    const refresh = () =>
      void Promise.allSettled(repos.map((repo) => loadTagged(repo, load))).then((results) => {
        if (alive) setItems(results.flatMap((r) => (r.status === 'fulfilled' ? r.value : [])))
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

  return items
}

function HomeCard({
  icon,
  title,
  count,
  empty,
  children,
}: {
  icon: ReactNode
  title: string
  count: number | null
  empty: string
  children: ReactNode
}) {
  let body = <div className="space-y-0.5">{children}</div>

  if (count === null) {
    body = (
      <div className="space-y-1.5">
        {[0, 1].map((i) => (
          <div key={i} className="h-7 rounded-md bg-zGray-800/40 animate-pulse" />
        ))}
      </div>
    )
  } else if (count === 0) {
    body = <div className="px-1 py-1.5 text-[12px] text-tertiary">{empty}</div>
  }

  return (
    <section className="min-w-0 rounded-lg border border-zGray-800/60 p-3">
      <div className="mb-2 flex items-center gap-1.5 px-1 text-[12px] text-secondary">
        {icon}
        <span>{title}</span>
        {count !== null && <span className="text-tertiary tabular-nums">{count}</span>}
      </div>
      {body}
    </section>
  )
}

function HomeRow({
  url,
  icon,
  title,
  meta,
}: {
  url: string
  icon: ReactNode
  title: string
  meta: string
}) {
  return (
    <BaseButton
      onClick={() => openOnGithub(url)}
      className="group flex w-full items-center gap-2 rounded-md px-1 py-1.5 text-left outline-none transition-colors hover:bg-zGray-800/60 focus-visible:bg-zGray-800/60"
    >
      <span className="flex-shrink-0">{icon}</span>
      <span className="min-w-0 flex-1 truncate text-[13px] text-secondary group-hover:text-main">
        {title}
      </span>
      <span className="flex-shrink-0 font-mono text-[11px] text-tertiary">{meta}</span>
    </BaseButton>
  )
}

const loadPulls = (teamId: string) => (repo: HomeRepo, owner: string, name: string) =>
  api.atlasListGithubPulls(teamId, repo.installationId, owner, name, 'open')

const loadRuns = (teamId: string) => async (repo: HomeRepo, owner: string, name: string) =>
  failingRuns(
    (await api.atlasListGithubActionRuns(teamId, repo.installationId, owner, name, 1)).runs,
  )

export function PullRequestsCard({ teamId, repos }: { teamId: string; repos: HomeRepo[] }) {
  const pulls = useRepoItems(repos, loadPulls(teamId))
  const sorted = pulls?.toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt))

  return (
    <HomeCard
      icon={<GitPullRequest className="h-3.5 w-3.5" strokeWidth={1.8} />}
      title="Pull requests"
      count={sorted?.length ?? null}
      empty="No open pull requests"
    >
      {sorted?.slice(0, MAX_ROWS).map((pr) => (
        <HomeRow
          key={`${pr.repo}#${String(pr.number)}`}
          url={pr.htmlUrl}
          icon={
            pr.draft ? (
              <GitPullRequestDraft className="h-3.5 w-3.5 text-tertiary" strokeWidth={1.8} />
            ) : (
              <GitPullRequest className="h-3.5 w-3.5 text-[#73bf69]" strokeWidth={1.8} />
            )
          }
          title={pr.title}
          meta={`${pr.repo.split('/')[1]}#${String(pr.number)} · ${pr.author}`}
        />
      ))}
    </HomeCard>
  )
}

export function CiFailuresCard({ teamId, repos }: { teamId: string; repos: HomeRepo[] }) {
  const runs = useRepoItems(repos, loadRuns(teamId))
  const sorted = runs?.toSorted((a, b) => b.createdAt.localeCompare(a.createdAt))

  return (
    <HomeCard
      icon={<CircleX className="h-3.5 w-3.5" strokeWidth={1.8} />}
      title="CI failures"
      count={sorted?.length ?? null}
      empty="Nothing failing"
    >
      {sorted?.slice(0, MAX_ROWS).map((run) => (
        <HomeRow
          key={run.id}
          url={run.htmlUrl}
          icon={<CircleX className="h-3.5 w-3.5 text-error" strokeWidth={1.8} />}
          title={`${run.name} · ${run.headBranch}`}
          meta={`${run.repo.split('/')[1]} · ${formatAge(run.createdAt)}`}
        />
      ))}
    </HomeCard>
  )
}
