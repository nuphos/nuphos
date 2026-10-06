import clsx from 'clsx'
import { FileDiff, GitCommitHorizontal } from 'lucide-react'

import { MessageResponse } from '../../components/agent/MessageResponse'
import { relativeTimeFromNow } from '../../components/agent/panel/textUtils'
import { Avatar } from '../../components/Avatar'

import { DiffLine } from './ChangedFile'
import { openOnGithub } from './openOnGithub'
import { humanize, plural } from './pullRequestChecks'
import { PullRequestMergeBox } from './PullRequestMergeBox'
import { PullRequestSidebar } from './PullRequestSidebar'
import { reviewVerb } from './pullRequestStatus'
import { TONE_BADGE } from './toneClasses'

import type { PullRequestStatus } from './pullRequestStatus'
import type { GithubPRComment, GithubPRCommit, GithubPRDetail, GithubPRReview } from '../../types'
import type { ReactNode } from 'react'

// The commented line is the last one of the hunk; a few lines above it are
// enough context to place the comment without re-reading the whole diff.
const HUNK_CONTEXT_LINES = 4

function Timestamp({ value }: { value: string }) {
  const date = new Date(value)

  return (
    <time
      dateTime={value}
      title={Number.isNaN(date.getTime()) ? undefined : date.toLocaleString()}
      className="text-tertiary"
    >
      {relativeTimeFromNow(value)}
    </time>
  )
}

function AuthorLine({
  name,
  avatarUrl,
  verb,
  at,
}: {
  name: string
  avatarUrl: string
  verb: string
  at: string
}) {
  return (
    <div className="flex min-w-0 items-center gap-2 text-[12px] text-tertiary">
      <Avatar src={avatarUrl} name={name} size={20} className="rounded-full" />
      <span className="truncate">
        <span className="font-medium text-main">{name}</span> {verb} <Timestamp value={at} />
      </span>
    </div>
  )
}

function Card({
  header,
  trailing,
  children,
}: {
  header: ReactNode
  trailing?: ReactNode
  children?: ReactNode
}) {
  return (
    <section className="divide-y divide-zGray-800/70 overflow-hidden rounded-lg border border-zGray-800/80 bg-zGray-900/50">
      <div className="flex items-center justify-between gap-2 px-3 py-2">
        {header}
        {trailing}
      </div>
      {children}
    </section>
  )
}

function Markdown({ children }: { children: string }) {
  return (
    <div className="px-4 py-3">
      <MessageResponse className="text-[13px]" streaming={false}>
        {children}
      </MessageResponse>
    </div>
  )
}

function DescriptionCard({ pull }: { pull: GithubPRDetail }) {
  return (
    <Card
      header={
        <AuthorLine
          name={pull.author}
          avatarUrl={pull.authorAvatarUrl}
          verb="opened this pull request"
          at={pull.createdAt}
        />
      }
    >
      {pull.body?.trim() ? (
        <Markdown>{pull.body}</Markdown>
      ) : (
        <div className="px-4 py-3 text-[12px] italic text-tertiary">No description provided.</div>
      )}
    </Card>
  )
}

function CommentCard({ comment }: { comment: GithubPRComment }) {
  const hunk = comment.diffHunk?.split('\n').slice(-HUNK_CONTEXT_LINES) ?? []

  return (
    <Card
      header={
        <AuthorLine
          name={comment.author}
          avatarUrl={comment.authorAvatarUrl}
          verb="commented"
          at={comment.createdAt}
        />
      }
    >
      {comment.path && (
        <div className="flex items-center gap-1.5 bg-zGray-900/40 px-3 py-1.5 font-mono text-[11px] text-secondary">
          <FileDiff className="h-3 w-3 shrink-0 text-tertiary" strokeWidth={1.8} />
          <span className="min-w-0 truncate" title={comment.path}>
            {comment.path}
            {comment.line ? `:${String(comment.line)}` : ''}
          </span>
        </div>
      )}
      {hunk.length > 0 && (
        <div className="overflow-x-auto py-1 scrollbar-thin">
          {hunk.map((line, index) => (
            <DiffLine key={`${String(index)}:${line}`} line={line} />
          ))}
        </div>
      )}
      <Markdown>{comment.body}</Markdown>
    </Card>
  )
}

function ReviewCard({ review, at }: { review: GithubPRReview; at: string }) {
  const verb = reviewVerb(review.state)

  return (
    <Card
      header={
        <AuthorLine
          name={review.author}
          avatarUrl={review.authorAvatarUrl}
          verb={verb.label}
          at={at}
        />
      }
      trailing={
        <span
          className={clsx(
            'inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[10.5px] font-semibold capitalize ring-1 ring-inset',
            TONE_BADGE[verb.tone],
          )}
        >
          {humanize(review.state.toLowerCase())}
        </span>
      }
    >
      {review.body?.trim() ? <Markdown>{review.body}</Markdown> : null}
    </Card>
  )
}

function CommitsCard({ commits }: { commits: GithubPRCommit[] }) {
  const [first] = commits

  return (
    <Card
      header={
        <AuthorLine
          name={first.author}
          avatarUrl={first.authorAvatarUrl}
          verb={`added ${plural(commits.length, 'commit')}`}
          at={first.committedAt}
        />
      }
    >
      <ul className="py-1">
        {commits.map((commit) => (
          <li key={commit.sha} className="flex items-center gap-2 px-3 py-1 text-[12px]">
            <GitCommitHorizontal className="h-3.5 w-3.5 shrink-0 text-tertiary" strokeWidth={1.8} />
            <Avatar
              src={commit.authorAvatarUrl}
              name={commit.author}
              size={16}
              className="shrink-0 rounded-full"
            />
            <span className="min-w-0 flex-1 truncate text-secondary" title={commit.headline}>
              {commit.headline}
            </span>
            <button
              type="button"
              onClick={() => openOnGithub(commit.htmlUrl)}
              className="shrink-0 font-mono text-[11px] text-tertiary hover:text-secondary hover:underline"
            >
              {commit.sha.slice(0, 7)}
            </button>
          </li>
        ))}
      </ul>
    </Card>
  )
}

export function PullRequestConversation({
  pull,
  status,
}: {
  pull: GithubPRDetail
  status: PullRequestStatus
}) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
      <div className="mx-auto max-w-3xl space-y-4 px-3 py-3 @sm:px-4 @sm:py-4 @xl:px-5 @xl:py-5">
        <PullRequestSidebar pull={pull} reviewers={status.review.reviewers} />
        <main className="min-w-0 space-y-4">
          <DescriptionCard pull={pull} />
          {status.timeline.map((item) => {
            if (item.kind === 'comment') {
              return (
                <CommentCard key={`comment-${String(item.comment.id)}`} comment={item.comment} />
              )
            }
            if (item.kind === 'commits') {
              return <CommitsCard key={`commits-${item.commits[0].sha}`} commits={item.commits} />
            }

            return (
              <ReviewCard
                key={`review-${String(item.review.id)}`}
                review={item.review}
                at={item.at}
              />
            )
          })}
          <PullRequestMergeBox pull={pull} status={status} />
        </main>
      </div>
    </div>
  )
}
