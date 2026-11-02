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

import { t } from '../../../i18n'
import { ResourcePreview } from '../../ui/resource-preview'
import { ChatLink } from '../MessageResponse'

import { useGithubRef } from './githubRefStore'

import type { GithubRef } from './githubRefs'
import type { OpenLink } from './LocalUrlChip'
import type { GithubRefState, GithubRefSummary } from '../../../types/github-pr-detail'
import type { LucideIcon } from 'lucide-react'
import type { MouseEvent, ReactNode } from 'react'

const STATE: Record<GithubRefState, { label: string; tone: string }> = {
  open: { label: t('Open|state'), tone: 'text-success' },
  draft: { label: t('Draft'), tone: 'text-tertiary' },
  merged: { label: t('Merged'), tone: 'text-zViolet-accent' },
  closed: { label: t('Closed'), tone: 'text-error' },
  completed: { label: t('Closed'), tone: 'text-zViolet-accent' },
  not_planned: { label: t('Not planned'), tone: 'text-tertiary' },
}

const REVIEW = {
  approved: { label: t('Approved'), tone: 'bg-success/10 text-success' },
  changes_requested: { label: t('Changes requested'), tone: 'bg-error/10 text-error' },
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
  const pull = ref.kind === 'pull'

  if (!summary) return pull ? t('Pull request {name}', { name }) : t('Issue {name}', { name })
  const review = summary.review ? ` · ${REVIEW[summary.review].label}` : ''
  const state = STATE[summary.state].label
  const line = pull
    ? t('{state} pull request · {name}', { state, name })
    : t('{state} issue · {name}', { state, name })

  return `${summary.title}\n${line}${review}`
}

/** The preview card's open button: the chat's own link handler, else a new window. */
function openFromPreview(href: string, onOpen?: OpenLink) {
  return (event: MouseEvent) => {
    if (onOpen?.(href, event.metaKey)) return
    window.open(href, '_blank', 'noopener')
  }
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
      onOpen={openFromPreview(ref.href, onOpen)}
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
      onOpen={openFromPreview(ref.href, onOpen)}
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
      <span>{t('On GitHub')}</span>
      {refs.map((ref) => (
        <GithubRefChip key={ref.url} githubRef={ref} teamId={teamId} onOpen={onOpen} />
      ))}
    </div>
  )
}
