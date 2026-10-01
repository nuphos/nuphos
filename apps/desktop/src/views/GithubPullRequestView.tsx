import clsx from 'clsx'
import { CircleDot, ExternalLink, GitMerge, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import { Button } from '../components/ui/button'

import { ChangedFile } from './github-repo/ChangedFile'
import { openOnGithub } from './github-repo/openOnGithub'
import { PullRequestConversation } from './github-repo/PullRequestConversation'
import { pullRequestStatus } from './github-repo/pullRequestStatus'
import { TONE_BADGE } from './github-repo/toneClasses'
import { useGithubPull } from './github-repo/useGithubPull'

import type { GithubInstallation, GithubPRDetail, GithubRepository } from '../types'
import type { StatusTone } from './github-repo/pullRequestChecks'

type Props = {
  teamId: string
  installation: GithubInstallation
  repo: GithubRepository
  pullNumber: number
  refreshKey: number
  onCount: (count: number) => void
  onLoaded: (title: string) => void
}

function StateBadge({ pull }: { pull: GithubPRDetail }) {
  let Icon = X
  let label: string = pull.state
  let tone: StatusTone = 'error'

  if (pull.merged) {
    Icon = GitMerge
    label = 'Merged'
    tone = 'merged'
  } else if (pull.state === 'open') {
    Icon = CircleDot
    label = pull.draft ? 'Draft' : pull.state
    tone = pull.draft ? 'neutral' : 'success'
  }

  return (
    <span
      className={clsx(
        'inline-flex self-start items-center gap-1 rounded-full px-2 py-1 text-[11px] font-semibold capitalize ring-1 ring-inset',
        TONE_BADGE[tone],
      )}
    >
      <Icon className="h-3 w-3" strokeWidth={2} />
      {label}
    </span>
  )
}

function BranchChip({ name }: { name: string }) {
  return (
    <span
      className="inline-block max-w-[220px] truncate rounded bg-zViolet-accent/10 px-1.5 py-0.5 align-bottom font-mono text-[11px] text-zViolet-accent"
      title={name}
    >
      {name}
    </span>
  )
}

function mergeVerb(pull: GithubPRDetail): string {
  if (pull.merged) return 'merged'
  if (pull.state === 'closed') return 'wanted to merge'

  return 'wants to merge'
}

export function GithubPullRequestView({
  teamId,
  installation,
  repo,
  pullNumber,
  refreshKey,
  onCount,
  onLoaded,
}: Props) {
  const [tab, setTab] = useState<'conversation' | 'files'>('conversation')
  const { pull, error } = useGithubPull(
    teamId,
    installation.installationId,
    repo,
    pullNumber,
    refreshKey,
  )
  const status = useMemo(() => (pull ? pullRequestStatus(pull) : null), [pull])

  useEffect(() => onCount(0), [onCount])
  useEffect(() => {
    if (pull) onLoaded(pull.title)
  }, [onLoaded, pull])

  if (error) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-4 text-center">
        <div className="text-[12.5px] text-error">{error}</div>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => openOnGithub(`${repo.htmlUrl}/pull/${String(pullNumber)}`)}
        >
          <ExternalLink className="h-3.5 w-3.5" strokeWidth={1.8} />
          Open in GitHub
        </Button>
      </div>
    )
  }
  if (!pull || !status) {
    return (
      <div className="flex flex-1 items-center justify-center text-[12.5px] text-tertiary">
        Loading…
      </div>
    )
  }

  const activityCount = status.timeline.length

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b border-zGray-800/70">
        <div className="mx-auto w-full max-w-6xl px-3 pb-3 pt-3 @sm:px-4 @xl:px-5 @xl:pt-4">
          <div className="flex min-w-0 flex-col gap-2 @sm:flex-row @sm:items-start @sm:gap-3">
            <StateBadge pull={pull} />
            <div className="min-w-0 flex-1">
              <h1 className="break-words text-[16px] font-semibold leading-5 text-main @xl:text-[17px] @xl:leading-6">
                {pull.title} <span className="font-normal text-tertiary">#{pull.number}</span>
              </h1>
              <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-[11.5px] text-tertiary">
                <span className="font-medium text-secondary">{pull.author}</span>
                <span className="whitespace-nowrap">
                  {mergeVerb(pull)} {pull.commits} {pull.commits === 1 ? 'commit' : 'commits'} into
                </span>
                <BranchChip name={pull.baseRef} />
                <span>from</span>
                <BranchChip name={pull.headRef} />
                <span className="ml-1.5 inline-flex items-center gap-2 whitespace-nowrap">
                  <span className="font-medium text-success">+{pull.additions}</span>
                  <span className="font-medium text-error">−{pull.deletions}</span>
                </span>
              </div>
            </div>
          </div>
          <div className="mt-3 flex items-center gap-1 overflow-x-auto scrollbar-thin">
            {(['conversation', 'files'] as const).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setTab(value)}
                className={clsx(
                  'h-7 shrink-0 whitespace-nowrap rounded-md px-2.5 text-[12px] capitalize transition-colors',
                  tab === value ? 'bg-zGray-800 text-main' : 'text-tertiary hover:text-secondary',
                )}
              >
                {value === 'conversation'
                  ? `Conversation (${String(activityCount)})`
                  : `Files changed (${String(pull.changedFiles)})`}
              </button>
            ))}
          </div>
        </div>
      </div>

      {tab === 'conversation' ? (
        <PullRequestConversation pull={pull} status={status} />
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
          <div className="mx-auto max-w-6xl space-y-3 px-3 py-3 @sm:px-4 @sm:py-4 @xl:space-y-4 @xl:px-5 @xl:py-5">
            {pull.files.map((file) => (
              <ChangedFile key={file.filename} file={file} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
