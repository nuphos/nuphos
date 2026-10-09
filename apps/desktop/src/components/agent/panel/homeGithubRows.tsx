import { Button as BaseButton } from '@base-ui/react/button'
import { GitPullRequest, GitPullRequestDraft } from 'lucide-react'

import { formatAge } from '../../../utils'
import { LabelChip } from '../../../views/github-repo/PullRequestSidebar'
import { RunStatusIcon } from '../../../views/github-repo/RunStatusIcon'

import type { GithubPR, GithubWorkflowRun } from '../../../types'
import type { ReactNode } from 'react'

const repoName = (repo: string) => repo.split('/')[1] ?? repo

const MAX_LABELS = 3

export type WithRepo<T> = T & { repo: string; installationId: number }

function HomeRow({
  onOpen,
  icon,
  title,
  labels,
  meta,
}: {
  onOpen: () => void
  icon: ReactNode
  title: string
  /** Shown only when the card is wide enough, as GitHub's own lists do. */
  labels?: ReactNode
  meta: string
}) {
  return (
    <BaseButton
      onClick={onOpen}
      className="group flex w-full items-center gap-2 rounded-md px-1 py-1.5 text-left outline-none transition-colors hover:bg-zGray-800/60 focus-visible:bg-zGray-800/60"
    >
      <span className="flex-shrink-0">{icon}</span>
      <span className="min-w-0 flex-1 truncate text-[13px] text-secondary group-hover:text-main">
        {title}
      </span>
      {labels && (
        <span className="hidden max-w-[45%] flex-shrink-0 items-center gap-1 overflow-hidden @lg:flex">
          {labels}
        </span>
      )}
      <span className="flex-shrink-0 font-mono text-[11px] text-tertiary">{meta}</span>
    </BaseButton>
  )
}

export function PullRows({
  pulls,
  onOpen,
}: {
  pulls: WithRepo<GithubPR>[]
  onOpen: (item: WithRepo<GithubPR>) => void
}) {
  return pulls.map((pr) => (
    <HomeRow
      key={`${pr.repo}#${String(pr.number)}`}
      onOpen={() => onOpen(pr)}
      icon={
        pr.draft ? (
          <GitPullRequestDraft className="h-3.5 w-3.5 text-tertiary" strokeWidth={1.8} />
        ) : (
          <GitPullRequest className="h-3.5 w-3.5 text-[#73bf69]" strokeWidth={1.8} />
        )
      }
      title={pr.title}
      labels={
        pr.labels.length > 0 && (
          <>
            {pr.labels.slice(0, MAX_LABELS).map((l) => (
              <LabelChip key={l.name} name={l.name} color={l.color} />
            ))}
            {pr.labels.length > MAX_LABELS && (
              <span className="text-[11px] text-tertiary">+{pr.labels.length - MAX_LABELS}</span>
            )}
          </>
        )
      }
      meta={`${repoName(pr.repo)}#${String(pr.number)} · ${pr.author}`}
    />
  ))
}

export function RunRows({
  runs,
  onOpen,
}: {
  runs: WithRepo<GithubWorkflowRun>[]
  onOpen: (item: WithRepo<GithubWorkflowRun>) => void
}) {
  return runs.map((run) => (
    <HomeRow
      key={run.id}
      onOpen={() => onOpen(run)}
      icon={<RunStatusIcon run={run} />}
      title={`${run.name} · ${run.headBranch}`}
      meta={`${repoName(run.repo)} · ${formatAge(run.createdAt)}`}
    />
  ))
}
