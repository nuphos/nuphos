import clsx from 'clsx'
import {
  CircleCheck,
  CircleDot,
  CircleSlash,
  GitMerge,
  GitPullRequest,
  GitPullRequestClosed,
  GitPullRequestDraft,
} from 'lucide-react'

import { ResourcePreview } from '../../ui/resource-preview'
import { ChatLink } from '../MessageResponse'

import { useGithubRef } from './githubRefStore'

import type { GithubRef } from './githubRefs'
import type { OpenLink } from './LocalUrlChip'
import type { GithubRefState, GithubRefSummary } from '../../../types/github-pr-detail'
import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

const STATE: Record<GithubRefState, { label: string; tone: string }> = {
  open: { label: 'Open', tone: 'text-success' },
  draft: { label: 'Draft', tone: 'text-tertiary' },
  merged: { label: 'Merged', tone: 'text-zViolet-accent' },
  closed: { label: 'Closed', tone: 'text-error' },
  completed: { label: 'Closed', tone: 'text-zViolet-accent' },
  not_planned: { label: 'Not planned', tone: 'text-tertiary' },
}

const REVIEW = {
  approved: { label: 'Approved', tone: 'bg-success/10 text-success' },
  changes_requested: { label: 'Changes requested', tone: 'bg-error/10 text-error' },
} as const

const PULL_ICON: Record<GithubRefState, LucideIcon> = {
  open: GitPullRequest,
  draft: GitPullRequestDraft,
  merged: GitMerge,
  closed: GitPullRequestClosed,
  completed: GitPullRequest,
  not_planned: GitPullRequest,
}

const ISSUE_ICON: Record<GithubRefState, LucideIcon> = {
  open: CircleDot,
  draft: CircleDot,
  merged: CircleCheck,
  closed: CircleCheck,
  completed: CircleCheck,
  not_planned: CircleSlash,
}

function StateIcon({ kind, state }: { kind: GithubRef['kind']; state?: GithubRefState }) {
  const Icon = (kind === 'issue' ? ISSUE_ICON : PULL_ICON)[state ?? 'open']

  return (
    <Icon
      aria-hidden
      strokeWidth={2}
      className={clsx('size-3.5 shrink-0', state ? STATE[state].tone : 'text-tertiary')}
    />
  )
}

function describe(ref: GithubRef, summary: GithubRefSummary | null | undefined): string {
  const name = `${ref.owner}/${ref.repo}#${String(ref.number)}`
  const noun = ref.kind === 'pull' ? 'Pull request' : 'Issue'

  if (!summary) return `${noun} ${name}`
  const review = summary.review ? ` · ${REVIEW[summary.review].label}` : ''

  return `${summary.title}\n${STATE[summary.state].label} ${noun.toLowerCase()} · ${name}${review}`
}

const CHIP =
  'group/gh inline-flex h-[22px] max-w-full items-center gap-1.5 rounded-md border border-zGray-800 bg-zGray-900/60 px-1.5 align-middle text-[12.5px] leading-none text-main no-underline transition-colors duration-150 hover:border-zGray-700 hover:bg-zGray-850 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zViolet-accent motion-reduce:transition-none'

/** A pull request or issue with its title, number and state; opens like any chat link. */
export function GithubRefChip({
  githubRef: ref,
  teamId,
  onOpen,
}: {
  githubRef: GithubRef
  teamId?: string
  onOpen?: OpenLink
}) {
  const entry = useGithubRef(ref, teamId)
  const summary = entry?.summary

  return (
    <ResourcePreview
      repository={`${ref.owner}/${ref.repo}`}
      identifier={`#${String(ref.number)}`}
      title={summary?.title}
      state={summary ? STATE[summary.state].label : undefined}
      review={summary?.review ? REVIEW[summary.review].label : undefined}
      loading={entry?.loading}
    >
      <ChatLink
        link={ref.href}
        onLinkClick={onOpen}
        className={CHIP}
        aria-label={describe(ref, summary)}
      >
        <StateIcon kind={ref.kind} state={summary?.state} />
        <span className="min-w-0 max-w-[18ch] truncate leading-5 text-secondary">{ref.repo}</span>
        <span className="shrink-0 tabular-nums text-tertiary">#{ref.number}</span>
      </ChatLink>
    </ResourcePreview>
  )
}

/** A labelled link to a pull request or issue keeps its words and gains the state icon. */
export function GithubRefLink({
  githubRef: ref,
  teamId,
  onOpen,
  children,
}: {
  githubRef: GithubRef
  teamId?: string
  onOpen?: OpenLink
  children: ReactNode
}) {
  const summary = useGithubRef(ref, teamId)?.summary

  return (
    <ResourcePreview
      repository={`${ref.owner}/${ref.repo}`}
      identifier={`#${String(ref.number)}`}
      title={summary?.title}
      state={summary ? STATE[summary.state].label : undefined}
      review={summary?.review ? REVIEW[summary.review].label : undefined}
    >
      <ChatLink
        link={ref.href}
        onLinkClick={onOpen}
        className="text-zViolet-accent hover:underline"
        aria-label={describe(ref, summary)}
      >
        <span className="mr-0.5 inline-flex align-[-0.15em]">
          <StateIcon kind={ref.kind} state={summary?.state} />
        </span>
        {children}
      </ChatLink>
    </ResourcePreview>
  )
}

/** Pull requests and issues this turn's tools returned that the answer never linked. */
export function GithubRefStrip({
  refs,
  teamId,
  onOpen,
}: {
  refs: GithubRef[]
  teamId?: string
  onOpen?: OpenLink
}) {
  if (refs.length === 0) return null

  return (
    <div className="t-chat-card-in flex flex-wrap items-center gap-x-2 gap-y-1.5 text-[12.5px] text-tertiary">
      <span>On GitHub</span>
      {refs.map((ref) => (
        <GithubRefChip key={ref.url} githubRef={ref} teamId={teamId} onOpen={onOpen} />
      ))}
    </div>
  )
}
