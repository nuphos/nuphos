import { Collapsible } from '@base-ui/react/collapsible'
import clsx from 'clsx'
import {
  Check,
  ChevronRight,
  Ellipsis,
  GitMerge,
  GitPullRequestClosed,
  GitPullRequestDraft,
  Minus,
  TriangleAlert,
  X,
} from 'lucide-react'

import { openOnGithub } from './openOnGithub'
import { checkOutcome, checkStatusText, sortChecks } from './pullRequestChecks'
import { TONE_CIRCLE } from './toneClasses'

import type { CheckOutcome, StatusIconKind, StatusSummary } from './pullRequestChecks'
import type { PullRequestStatus } from './pullRequestStatus'
import type { GithubPRCheck, GithubPRDetail } from '../../types'
import type { LucideIcon } from 'lucide-react'

const STATUS_ICONS: Record<StatusIconKind, LucideIcon> = {
  check: Check,
  x: X,
  pending: Ellipsis,
  alert: TriangleAlert,
  merged: GitMerge,
  closed: GitPullRequestClosed,
  draft: GitPullRequestDraft,
}

const CHECK_ICONS: Record<CheckOutcome, { icon: LucideIcon; tone: string }> = {
  success: { icon: Check, tone: 'text-success' },
  failure: { icon: X, tone: 'text-error' },
  pending: { icon: Ellipsis, tone: 'text-warning' },
  skipped: { icon: Minus, tone: 'text-tertiary' },
  neutral: { icon: Minus, tone: 'text-tertiary' },
}

function StatusRow({ summary }: { summary: StatusSummary }) {
  const Icon = STATUS_ICONS[summary.icon]

  return (
    <>
      <span
        className={clsx(
          'flex h-7 w-7 shrink-0 items-center justify-center rounded-full',
          TONE_CIRCLE[summary.tone],
        )}
      >
        <Icon className="h-3.5 w-3.5" strokeWidth={2.5} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-semibold leading-5 text-main">{summary.headline}</div>
        <div className="mt-0.5 text-[12px] leading-4 text-secondary">{summary.detail}</div>
      </div>
    </>
  )
}

function CheckRow({ check }: { check: GithubPRCheck }) {
  const { icon: Icon, tone } = CHECK_ICONS[checkOutcome(check)]
  const { detailsUrl } = check

  return (
    <div className="flex items-center gap-2.5 px-4 py-1.5 text-[12px]">
      <Icon className={clsx('h-3.5 w-3.5 shrink-0', tone)} strokeWidth={2.25} />
      {check.appName && (
        <span className="hidden shrink-0 text-tertiary @sm:inline">{check.appName}</span>
      )}
      <span className="min-w-0 flex-1 truncate text-main" title={check.name}>
        {check.name}
      </span>
      <span className="shrink-0 capitalize text-tertiary">{checkStatusText(check)}</span>
      {detailsUrl && (
        <button
          type="button"
          className="shrink-0 rounded text-zViolet-accent hover:underline"
          onClick={() => openOnGithub(detailsUrl)}
        >
          Details
        </button>
      )}
    </div>
  )
}

function ChecksRow({ checks, summary }: { checks: GithubPRCheck[]; summary: StatusSummary }) {
  return (
    <Collapsible.Root>
      <Collapsible.Trigger className="group flex w-full items-start gap-3 px-4 py-3 text-left outline-none transition-colors hover:bg-zGray-800/40 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-zViolet-accent/60">
        <StatusRow summary={summary} />
        <ChevronRight
          className="mt-1.5 h-4 w-4 shrink-0 text-tertiary transition-transform group-data-[panel-open]:rotate-90"
          strokeWidth={2}
        />
      </Collapsible.Trigger>
      <Collapsible.Panel className="border-t border-zGray-800/70 bg-zGray-900/40">
        <div className="max-h-72 divide-y divide-zGray-800/50 overflow-y-auto scrollbar-thin">
          {sortChecks(checks).map((check) => (
            <CheckRow key={check.id} check={check} />
          ))}
        </div>
      </Collapsible.Panel>
    </Collapsible.Root>
  )
}

export function PullRequestMergeBox({
  pull,
  status,
}: {
  pull: GithubPRDetail
  status: PullRequestStatus
}) {
  const closed = pull.merged || pull.state === 'closed'
  const mergeRow = (
    <div className="flex items-start gap-3 px-4 py-3">
      <StatusRow summary={status.merge} />
    </div>
  )

  return (
    <section className="divide-y divide-zGray-800/70 overflow-hidden rounded-lg border border-zGray-800/80 bg-zGray-900/50">
      {closed ? (
        mergeRow
      ) : (
        <div className="flex items-start gap-3 px-4 py-3">
          <StatusRow summary={status.review} />
        </div>
      )}
      {status.checks && <ChecksRow checks={pull.checks} summary={status.checks} />}
      {!closed && mergeRow}
    </section>
  )
}
