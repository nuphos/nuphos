import assert from 'node:assert/strict'
import { test } from 'node:test'

import { parseRefSummary } from './github-ref-summary.ts'

const wrap = (node: object | null) => ({ data: { repository: { issueOrPullRequest: node } } })
const issue = (extra: object) => wrap({ __typename: 'Issue', title: 'Bug', ...extra })
const pull = (extra: object) => wrap({ __typename: 'PullRequest', title: 'Add chips', ...extra })

test('parseRefSummary reads pull request states', () => {
  assert.equal(parseRefSummary(pull({ state: 'OPEN', isDraft: false }))?.state, 'open')
  assert.equal(parseRefSummary(pull({ state: 'OPEN', isDraft: true }))?.state, 'draft')
  assert.equal(parseRefSummary(pull({ state: 'MERGED' }))?.state, 'merged')
  assert.equal(parseRefSummary(pull({ state: 'CLOSED' }))?.state, 'closed')
})

test('parseRefSummary keeps the review decision only while a pull request is open', () => {
  const open = pull({ state: 'OPEN', reviewDecision: 'CHANGES_REQUESTED' })
  const merged = pull({ state: 'MERGED', reviewDecision: 'APPROVED' })

  assert.equal(parseRefSummary(open)?.review, 'changes_requested')
  assert.equal(parseRefSummary(merged)?.review, null)
})

test('parseRefSummary reads issue states', () => {
  assert.deepEqual(parseRefSummary(issue({ state: 'OPEN' })), {
    kind: 'issue',
    title: 'Bug',
    state: 'open',
    review: null,
  })
  assert.equal(
    parseRefSummary(issue({ state: 'CLOSED', stateReason: 'COMPLETED' }))?.state,
    'completed',
  )
  assert.equal(
    parseRefSummary(issue({ state: 'CLOSED', stateReason: 'NOT_PLANNED' }))?.state,
    'not_planned',
  )
})

test('parseRefSummary returns null for missing or unreadable items', () => {
  assert.equal(parseRefSummary(wrap(null)), null)
  assert.equal(parseRefSummary({ errors: [{ message: 'Not found' }] }), null)
  assert.equal(parseRefSummary(null), null)
})
