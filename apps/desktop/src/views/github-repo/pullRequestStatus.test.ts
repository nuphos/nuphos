import assert from 'node:assert/strict'
import { test } from 'node:test'

import { checkStatusText, sortChecks, summarizeChecks } from './pullRequestChecks.ts'
import {
  pullRequestStatus,
  reviewers,
  summarizeMerge,
  summarizeReviews,
  timelineItems,
} from './pullRequestStatus.ts'

import type { TimelineItem } from './pullRequestStatus.ts'
import type { GithubPRCheck, GithubPRDetail, GithubPRReview } from '../../types'

const detail = (overrides: Partial<GithubPRDetail> = {}): GithubPRDetail => ({
  number: 1,
  title: 'feat: thing',
  state: 'open',
  draft: false,
  author: 'alice',
  authorAvatarUrl: '',
  labels: [],
  createdAt: '2026-09-01T00:00:00Z',
  updatedAt: '2026-09-01T00:00:00Z',
  htmlUrl: 'https://github.com/zeabur/nuphos/pull/1',
  headRef: 'feat/thing',
  baseRef: 'main',
  body: null,
  merged: false,
  mergeable: true,
  mergeableState: 'clean',
  headSha: 'head',
  baseSha: 'base',
  additions: 1,
  deletions: 0,
  changedFiles: 1,
  commits: 1,
  comments: 0,
  reviewComments: 0,
  requestedReviewers: [],
  assignees: [],
  milestone: null,
  reviews: [],
  conversation: [],
  commitHistory: [],
  checks: [],
  files: [],
  ...overrides,
})

const check = (id: number, status: string, conclusion: string | null): GithubPRCheck => ({
  id,
  name: 'build-and-push / build',
  status,
  conclusion,
  detailsUrl: null,
  appName: 'GitHub Actions',
})

const review = (
  id: number,
  author: string,
  state: string,
  submittedAt: string | null,
  body: string | null = null,
): GithubPRReview => ({
  id,
  author,
  authorAvatarUrl: '',
  state,
  body,
  submittedAt,
  htmlUrl: '',
})

test('checks roll up into a GitHub-style headline and count line', () => {
  const passing = [
    ...Array.from({ length: 38 }, (_, index) => check(index, 'completed', 'success')),
    check(100, 'completed', 'skipped'),
    check(101, 'completed', 'skipped'),
  ]
  const summary = summarizeChecks(passing)

  assert.equal(summary?.tone, 'success')
  assert.equal(summary?.headline, 'All checks have passed')
  assert.equal(summary?.detail, '2 skipped, 38 successful checks')

  const failing = summarizeChecks([...passing, check(102, 'completed', 'timed_out')])

  assert.equal(failing?.tone, 'error')
  assert.equal(failing?.headline, 'Some checks were not successful')
  assert.equal(failing?.detail, '1 failing, 2 skipped, 38 successful checks')

  const running = summarizeChecks([check(1, 'in_progress', null), check(2, 'completed', 'success')])

  assert.equal(running?.tone, 'warning')
  assert.equal(running?.headline, "Some checks haven't completed yet")
  assert.equal(running?.detail, '1 in progress, 1 successful checks')

  assert.equal(summarizeChecks([]), null)
})

test('failing and running checks lead the expanded list', () => {
  const sorted = sortChecks([
    check(1, 'completed', 'success'),
    check(2, 'queued', null),
    check(3, 'completed', 'cancelled'),
  ])

  assert.deepEqual(
    sorted.map((item) => item.id),
    [3, 2, 1],
  )
  assert.deepEqual(sorted.map(checkStatusText), ['cancelled', 'queued', 'successful'])
})

test('a reviewer keeps their decision through later comments, until re-requested', () => {
  const pull = detail({
    reviews: [
      review(1, 'bob', 'APPROVED', '2026-09-01T01:00:00Z'),
      review(2, 'bob', 'COMMENTED', '2026-09-01T02:00:00Z', 'nit'),
      review(3, 'carol', 'CHANGES_REQUESTED', '2026-09-01T01:00:00Z'),
      review(4, 'carol', 'APPROVED', '2026-09-01T03:00:00Z'),
      review(5, 'alice', 'COMMENTED', '2026-09-01T03:00:00Z', 'self'),
      review(6, 'dave', 'APPROVED', '2026-09-01T03:00:00Z'),
    ],
    requestedReviewers: [{ login: 'dave', avatarUrl: '' }],
  })

  assert.deepEqual(
    reviewers(pull).map((reviewer) => [reviewer.login, reviewer.state]),
    [
      ['bob', 'approved'],
      ['carol', 'approved'],
      ['dave', 'pending'],
    ],
  )
})

test('review decision: changes requested beats approvals; comments alone are not a decision', () => {
  const contested = summarizeReviews(
    detail({
      reviews: [
        review(1, 'bob', 'APPROVED', '2026-09-01T01:00:00Z'),
        review(2, 'carol', 'CHANGES_REQUESTED', '2026-09-01T02:00:00Z'),
      ],
    }),
  )

  assert.equal(contested.decision, 'changes_requested')
  assert.equal(contested.tone, 'error')

  const commentedOnly = summarizeReviews(
    detail({ reviews: [review(1, 'bob', 'COMMENTED', '2026-09-01T01:00:00Z', 'looks odd')] }),
  )

  assert.equal(commentedOnly.decision, 'none')
  assert.equal(commentedOnly.headline, 'No approving reviews yet')
  assert.equal(commentedOnly.detail, '1 reviewer commented without approving.')

  const pending = summarizeReviews(
    detail({ requestedReviewers: [{ login: 'bob', avatarUrl: '' }] }),
  )

  assert.equal(pending.headline, 'Awaiting review')

  // A dismissed approval is not a comment; the sidebar says "Review dismissed".
  const dismissedOnly = summarizeReviews(
    detail({
      reviews: [
        review(1, 'bob', 'APPROVED', '2026-09-01T01:00:00Z'),
        review(2, 'bob', 'DISMISSED', '2026-09-01T02:00:00Z'),
      ],
    }),
  )

  assert.equal(dismissedOnly.headline, 'No approving reviews yet')
  assert.equal(dismissedOnly.detail, '1 review was dismissed.')

  const mixed = summarizeReviews(
    detail({
      reviews: [
        review(1, 'bob', 'DISMISSED', '2026-09-01T01:00:00Z'),
        review(2, 'carol', 'COMMENTED', '2026-09-01T02:00:00Z', 'hm'),
      ],
    }),
  )

  assert.equal(mixed.detail, '1 reviewer commented without approving; 1 review was dismissed.')

  // A blocked merge is never read as a review requirement: GitHub does not
  // say why it is blocked.
  const blocked = summarizeReviews(detail({ mergeableState: 'blocked' }))

  assert.equal(blocked.decision, 'none')
  assert.equal(blocked.headline, 'No reviews yet')
})

test('merge status mirrors the GitHub merge box', () => {
  const merged = summarizeMerge(
    detail({ merged: true, state: 'closed' }),
    null,
    summarizeReviews(detail()),
  )

  assert.equal(merged.tone, 'merged')
  assert.equal(merged.headline, 'Pull request successfully merged and closed')

  const conflicted = detail({ mergeable: false, mergeableState: 'dirty' })

  assert.equal(
    summarizeMerge(conflicted, null, summarizeReviews(conflicted)).headline,
    'This branch has conflicts that must be resolved',
  )

  const draft = detail({ draft: true, mergeableState: 'draft' })

  assert.equal(
    summarizeMerge(draft, null, summarizeReviews(draft)).headline,
    'This pull request is still a work in progress',
  )
})

test('a blocked merge names what it can prove and never contradicts the review row', () => {
  const changes = detail({
    mergeableState: 'blocked',
    reviews: [review(1, 'carol', 'CHANGES_REQUESTED', '2026-09-01T02:00:00Z')],
  })

  assert.equal(
    summarizeMerge(changes, null, summarizeReviews(changes)).detail,
    'A reviewer requested changes.',
  )

  const approvedButBlocked = detail({
    mergeableState: 'blocked',
    reviews: [review(1, 'bob', 'APPROVED', '2026-09-01T01:00:00Z')],
    checks: [check(1, 'completed', 'success')],
  })
  const approvedSummary = summarizeMerge(
    approvedButBlocked,
    summarizeChecks(approvedButBlocked.checks),
    summarizeReviews(approvedButBlocked),
  )

  assert.equal(approvedSummary.headline, 'Merging is blocked')
  assert.doesNotMatch(approvedSummary.detail, /approving review/)
  assert.match(approvedSummary.detail, /branch rule/)

  const failingChecks = detail({
    mergeableState: 'blocked',
    checks: [check(1, 'completed', 'failure')],
  })

  assert.equal(
    summarizeMerge(
      failingChecks,
      summarizeChecks(failingChecks.checks),
      summarizeReviews(failingChecks),
    ).detail,
    'Required status checks have failed.',
  )

  const unreviewed = detail({ mergeableState: 'blocked' })

  assert.match(
    summarizeMerge(unreviewed, null, summarizeReviews(unreviewed)).detail,
    /No approving review yet/,
  )
})

// c<id> for a comment, r<id> for a review, the joined SHAs for a commit group.
function timelineLabel(item: TimelineItem): string {
  switch (item.kind) {
    case 'comment':
      return `c${String(item.comment.id)}`
    case 'review':
      return `r${String(item.review.id)}`
    case 'commits':
      return item.commits.map((c) => c.sha).join('')
  }
}

test('the timeline interleaves comments and submitted reviews by time', () => {
  const pull = detail({
    conversation: [
      {
        id: 10,
        author: 'bob',
        authorAvatarUrl: '',
        body: 'first',
        createdAt: '2026-09-01T01:00:00Z',
        updatedAt: '2026-09-01T01:00:00Z',
        htmlUrl: '',
      },
      {
        id: 11,
        author: 'bob',
        authorAvatarUrl: '',
        body: 'inline',
        createdAt: '2026-09-01T03:00:00Z',
        updatedAt: '2026-09-01T03:00:00Z',
        htmlUrl: '',
        path: 'src/a.ts',
        line: 3,
      },
    ],
    reviews: [
      review(1, 'carol', 'APPROVED', '2026-09-01T02:00:00Z'),
      // The bodiless wrapper GitHub creates around inline comments.
      review(2, 'bob', 'COMMENTED', '2026-09-01T03:00:00Z', ''),
      review(3, 'dave', 'PENDING', null, 'draft'),
    ],
  })

  assert.deepEqual(timelineItems(pull).map(timelineLabel), ['c10', 'r1', 'c11'])
  // The Conversation tab counts what the timeline renders, not raw reviews.
  assert.equal(pullRequestStatus(pull).timeline.length, 3)
})

const commit = (sha: string, committedAt: string) => ({
  sha,
  headline: `commit ${sha}`,
  author: 'alice',
  authorAvatarUrl: '',
  committedAt,
  htmlUrl: '',
})

test('the timeline groups commits that have nothing between them', () => {
  const pull = detail({
    commitHistory: [
      commit('a', '2026-09-01T00:30:00Z'),
      commit('b', '2026-09-01T00:40:00Z'),
      commit('c', '2026-09-01T03:00:00Z'),
    ],
    reviews: [review(1, 'carol', 'CHANGES_REQUESTED', '2026-09-01T02:00:00Z')],
  })

  assert.deepEqual(timelineItems(pull).map(timelineLabel), ['ab', 'r1', 'c'])
})
