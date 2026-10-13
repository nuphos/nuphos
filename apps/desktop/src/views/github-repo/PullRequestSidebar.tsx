import clsx from 'clsx'
import { Check, Ellipsis, MessageSquare, X } from 'lucide-react'

import { Avatar } from '../../components/Avatar'

import type { Reviewer, ReviewerState } from './pullRequestStatus'
import type { GithubPRDetail } from '../../types'
import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

const REVIEWER_STATE: Record<ReviewerState, { icon: LucideIcon; tone: string; label: string }> = {
  approved: { icon: Check, tone: 'text-success', label: 'Approved' },
  changes_requested: { icon: X, tone: 'text-error', label: 'Requested changes' },
  commented: { icon: MessageSquare, tone: 'text-tertiary', label: 'Commented' },
  dismissed: { icon: Ellipsis, tone: 'text-tertiary', label: 'Review dismissed' },
  pending: { icon: Ellipsis, tone: 'text-warning', label: 'Awaiting review' },
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <div className="text-[12px] font-semibold text-secondary">{title}</div>
      {children}
    </section>
  )
}

function Empty({ children }: { children: ReactNode }) {
  return <div className="text-[12px] text-tertiary">{children}</div>
}

function Person({
  login,
  avatarUrl,
  trailing,
}: {
  login: string
  avatarUrl: string
  trailing?: ReactNode
}) {
  return (
    <div className="flex items-center gap-2 py-0.5">
      <Avatar src={avatarUrl} name={login} size={20} className="rounded-full" />
      <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-main">{login}</span>
      {trailing}
    </div>
  )
}

function ReviewerRow({ reviewer }: { reviewer: Reviewer }) {
  const { icon: Icon, tone, label } = REVIEWER_STATE[reviewer.state]

  return (
    <Person
      login={reviewer.login}
      avatarUrl={reviewer.avatarUrl}
      trailing={
        <span title={label} className="shrink-0">
          <Icon className={clsx('h-3.5 w-3.5', tone)} strokeWidth={2.25} aria-label={label} />
        </span>
      }
    />
  )
}

// GitHub label colours are arbitrary hex values the theme cannot vet.
export function LabelChip({ name, color }: { name: string; color: string }) {
  const hex = /^[0-9a-f]{6}$/i.test(color) ? `#${color}` : null

  return (
    <span
      className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-zGray-800 px-2 py-0.5 text-[11.5px] font-medium text-main"
      style={hex ? { backgroundColor: `${hex}26`, borderColor: `${hex}80` } : undefined}
    >
      <span
        className="h-2 w-2 shrink-0 rounded-full bg-zGray-500"
        style={hex ? { backgroundColor: hex } : undefined}
      />
      <span className="truncate">{name}</span>
    </span>
  )
}

export function PullRequestSidebar({
  pull,
  reviewers,
}: {
  pull: GithubPRDetail
  reviewers: Reviewer[]
}) {
  return (
    <aside className="grid grid-cols-1 gap-x-5 gap-y-4 rounded-lg border border-zGray-800/80 bg-zGray-900/50 p-3 @md:grid-cols-2">
      <Section title="Reviewers">
        {reviewers.length ? (
          reviewers.map((reviewer) => <ReviewerRow key={reviewer.login} reviewer={reviewer} />)
        ) : (
          <Empty>No reviews</Empty>
        )}
      </Section>
      <Section title="Assignees">
        {pull.assignees.length ? (
          pull.assignees.map((assignee) => (
            <Person key={assignee.login} login={assignee.login} avatarUrl={assignee.avatarUrl} />
          ))
        ) : (
          <Empty>No one assigned</Empty>
        )}
      </Section>
      <Section title="Labels">
        {pull.labels.length ? (
          <div className="flex flex-wrap gap-1.5">
            {pull.labels.map((label) => (
              <LabelChip key={label.name} name={label.name} color={label.color} />
            ))}
          </div>
        ) : (
          <Empty>None yet</Empty>
        )}
      </Section>
      <Section title="Milestone">
        {pull.milestone ? (
          <div className="text-[12.5px] text-main">{pull.milestone}</div>
        ) : (
          <Empty>No milestone</Empty>
        )}
      </Section>
    </aside>
  )
}
