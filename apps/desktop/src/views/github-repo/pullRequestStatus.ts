// Review, merge and timeline derivations behind the PR page's GitHub-style
// merge box and sidebar. React-free so `node --test` can lock the rules.
import { t } from '../../i18n/index.ts'

import { blockedDetail, summarizeChecks } from './pullRequestChecks.ts'

import type { StatusSummary } from './pullRequestChecks.ts'
import type { GithubPRComment, GithubPRCommit, GithubPRDetail, GithubPRReview } from '../../types'

export type ReviewerState = 'approved' | 'changes_requested' | 'commented' | 'dismissed' | 'pending'
export type Reviewer = { login: string; avatarUrl: string; state: ReviewerState }
export type ReviewSummary = StatusSummary & {
  decision: 'approved' | 'changes_requested' | 'none'
  reviewers: Reviewer[]
}

function reviewerStateAfter(
  current: ReviewerState | null,
  reviewState: string,
): ReviewerState | null {
  switch (reviewState.toUpperCase()) {
    case 'APPROVED':
      return 'approved'
    case 'CHANGES_REQUESTED':
      return 'changes_requested'
    case 'DISMISSED':
      return 'dismissed'
    // A plain comment never overturns an earlier decision.
    case 'COMMENTED':
      return current ?? 'commented'
    default:
      return null
  }
}

/** Latest decisive state per reviewer; a fresh review request resets a reviewer to pending. */
export function reviewers(pull: GithubPRDetail): Reviewer[] {
  const byLogin = new Map<string, Reviewer>()
  const submitted = pull.reviews
    .filter((review) => review.submittedAt)
    .sort((a, b) => (a.submittedAt ?? '').localeCompare(b.submittedAt ?? ''))

  for (const review of submitted) {
    if (review.author === pull.author) continue
    const state = reviewerStateAfter(byLogin.get(review.author)?.state ?? null, review.state)

    if (state) {
      byLogin.set(review.author, { login: review.author, avatarUrl: review.authorAvatarUrl, state })
    }
  }
  for (const reviewer of pull.requestedReviewers) {
    byLogin.set(reviewer.login, { ...reviewer, state: 'pending' })
  }

  return [...byLogin.values()]
}

function undecidedReviewText(all: Reviewer[]): { headline: string; detail: string } {
  const count = (state: ReviewerState) => all.filter((reviewer) => reviewer.state === state).length
  const pending = count('pending')
  const commented = count('commented')
  const dismissed = count('dismissed')

  if (pending > 0) {
    return {
      headline: t('Awaiting review'),
      detail:
        pending === 1
          ? t('{count} reviewer still needs to review.', { count: pending })
          : t('{count} reviewers still need to review.', { count: pending }),
    }
  }
  const parts = [
    commented > 0
      ? commented === 1
        ? t('{count} reviewer commented without approving', { count: commented })
        : t('{count} reviewers commented without approving', { count: commented })
      : null,
    dismissed > 0
      ? dismissed === 1
        ? t('{count} review was dismissed', { count: dismissed })
        : t('{count} reviews were dismissed', { count: dismissed })
      : null,
  ].filter((part) => part !== null)

  if (parts.length > 0) {
    return {
      headline: t('No approving reviews yet'),
      detail: t('{list}.', { list: parts.join('; ') }),
    }
  }

  return { headline: t('No reviews yet'), detail: t('No one has reviewed this pull request.') }
}

export function summarizeReviews(pull: GithubPRDetail): ReviewSummary {
  const all = reviewers(pull)
  const approvals = all.filter((reviewer) => reviewer.state === 'approved').length
  const changesRequested = all.filter((reviewer) => reviewer.state === 'changes_requested').length

  if (changesRequested > 0) {
    return {
      decision: 'changes_requested',
      reviewers: all,
      tone: 'error',
      icon: 'x',
      headline: t('Changes requested'),
      detail:
        changesRequested === 1
          ? t('{count} reviewer requested changes.', { count: changesRequested })
          : t('{count} reviewers requested changes.', { count: changesRequested }),
    }
  }
  if (approvals > 0) {
    return {
      decision: 'approved',
      reviewers: all,
      tone: 'success',
      icon: 'check',
      headline: t('Changes approved'),
      detail:
        approvals === 1
          ? t('{count} approving review.', { count: approvals })
          : t('{count} approving reviews.', { count: approvals }),
    }
  }

  return {
    decision: 'none',
    reviewers: all,
    tone: 'neutral',
    icon: 'pending',
    ...undecidedReviewText(all),
  }
}

function mergeSummaryBeforeRules(pull: GithubPRDetail): StatusSummary | null {
  if (pull.merged) {
    return {
      tone: 'merged',
      icon: 'merged',
      headline: t('Pull request successfully merged and closed'),
      detail: t('{head} was merged into {base}.', { head: pull.headRef, base: pull.baseRef }),
    }
  }
  if (pull.state === 'closed') {
    return {
      tone: 'neutral',
      icon: 'closed',
      headline: t('Closed with unmerged commits'),
      detail: t('The changes on {head} were not merged into {base}.', {
        head: pull.headRef,
        base: pull.baseRef,
      }),
    }
  }
  if (pull.draft) {
    return {
      tone: 'neutral',
      icon: 'draft',
      headline: t('This pull request is still a work in progress'),
      detail: t('Draft pull requests cannot be merged until they are marked ready for review.'),
    }
  }
  if (pull.mergeable === false || pull.mergeableState === 'dirty') {
    return {
      tone: 'error',
      icon: 'alert',
      headline: t('This branch has conflicts that must be resolved'),
      detail: t('Resolve the conflicts with {base} on GitHub or from the command line.', {
        base: pull.baseRef,
      }),
    }
  }

  return null
}

export function summarizeMerge(
  pull: GithubPRDetail,
  checks: StatusSummary | null,
  review: ReviewSummary,
): StatusSummary {
  const beforeRules = mergeSummaryBeforeRules(pull)

  if (beforeRules) return beforeRules

  switch (pull.mergeableState) {
    case 'blocked':
      return {
        tone: 'error',
        icon: 'alert',
        headline: t('Merging is blocked'),
        detail: blockedDetail(checks, review),
      }
    case 'behind':
      return {
        tone: 'warning',
        icon: 'pending',
        headline: t('This branch is out-of-date with the base branch'),
        detail: t('Merge the latest changes from {base} into this branch.', {
          base: pull.baseRef,
        }),
      }
    case 'unstable':
      return {
        tone: 'warning',
        icon: 'pending',
        headline: t('This branch has no conflicts with the base branch'),
        detail: t('Some checks were not successful, but merging is not blocked.'),
      }
    case 'clean':
    case 'has_hooks':
      return {
        tone: 'success',
        icon: 'check',
        headline: t('This branch has no conflicts with the base branch'),
        detail: t('Merging can be performed automatically.'),
      }
    default:
      return {
        tone: 'neutral',
        icon: 'pending',
        headline: t('Checking for ability to merge automatically…'),
        detail: t('GitHub is still working it out. Refresh in a moment.'),
      }
  }
}

export type TimelineItem =
  | { kind: 'comment'; at: string; comment: GithubPRComment }
  | { kind: 'review'; at: string; review: GithubPRReview }
  | { kind: 'commits'; at: string; commits: GithubPRCommit[] }

/**
 * Comments, submitted reviews and commits interleaved in time order, as on
 * GitHub. Commits with nothing between them share one entry.
 */
export function timelineItems(pull: GithubPRDetail): TimelineItem[] {
  const items: TimelineItem[] = pull.conversation.map((comment) => ({
    kind: 'comment',
    at: comment.createdAt,
    comment,
  }))

  for (const commit of pull.commitHistory ?? []) {
    items.push({ kind: 'commits', at: commit.committedAt, commits: [commit] })
  }

  for (const review of pull.reviews) {
    const state = review.state.toUpperCase()

    if (!review.submittedAt || state === 'PENDING') continue
    // GitHub wraps inline review comments in a bodiless COMMENTED review;
    // those comments already appear on their own.
    if (state === 'COMMENTED' && !review.body?.trim()) continue
    items.push({ kind: 'review', at: review.submittedAt, review })
  }

  const timeline: TimelineItem[] = []

  for (const item of items.toSorted((a, b) => a.at.localeCompare(b.at))) {
    const last = timeline.at(-1)

    if (item.kind === 'commits' && last?.kind === 'commits') last.commits.push(...item.commits)
    else timeline.push(item)
  }

  return timeline
}

export type PullRequestStatus = {
  checks: StatusSummary | null
  review: ReviewSummary
  merge: StatusSummary
  timeline: TimelineItem[]
}

/** Everything the PR page derives from one payload, computed once per payload. */
export function pullRequestStatus(pull: GithubPRDetail): PullRequestStatus {
  const checks = summarizeChecks(pull.checks)
  const review = summarizeReviews(pull)

  return {
    checks,
    review,
    merge: summarizeMerge(pull, checks, review),
    timeline: timelineItems(pull),
  }
}
