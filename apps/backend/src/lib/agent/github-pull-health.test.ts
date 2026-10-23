import { expect, test } from 'bun:test'

import { pullHealth } from './github-pull-health'

const clean = { checkConclusions: ['success', 'skipped', null], reviews: [] }

test('an open PR with passing or running checks and no objections is not blocked', () => {
  expect(pullHealth(clean)).toBeNull()
  expect(pullHealth({ ...clean, statusState: 'success', mergeableState: 'clean' })).toBeNull()
  // GitHub is still computing mergeability.
  expect(pullHealth({ ...clean, mergeableState: 'unknown' })).toBeNull()
})

test('a failed check run or commit status makes it red', () => {
  for (const conclusion of ['failure', 'timed_out', 'cancelled', 'action_required'])
    expect(pullHealth({ ...clean, checkConclusions: ['success', conclusion] })).toBe(
      'checks_failed',
    )
  expect(pullHealth({ ...clean, statusState: 'error' })).toBe('checks_failed')
  // Failing checks outrank a conflict or requested changes.
  expect(
    pullHealth({
      ...clean,
      checkConclusions: ['failure'],
      mergeableState: 'dirty',
      reviews: [{ user: 'ana', state: 'CHANGES_REQUESTED' }],
    }),
  ).toBe('checks_failed')
})

test("a reviewer's latest decision counts: requested changes stay until approved or dismissed", () => {
  expect(pullHealth({ ...clean, reviews: [{ user: 'ana', state: 'CHANGES_REQUESTED' }] })).toBe(
    'changes_requested',
  )
  expect(
    pullHealth({
      ...clean,
      reviews: [
        { user: 'ana', state: 'CHANGES_REQUESTED' },
        { user: 'ana', state: 'COMMENTED' },
      ],
    }),
  ).toBe('changes_requested')
  expect(
    pullHealth({
      ...clean,
      reviews: [
        { user: 'ana', state: 'CHANGES_REQUESTED' },
        { user: 'ana', state: 'APPROVED' },
      ],
    }),
  ).toBeNull()
  expect(
    pullHealth({
      ...clean,
      reviews: [
        { user: 'ana', state: 'CHANGES_REQUESTED' },
        { user: 'ana', state: 'DISMISSED' },
      ],
    }),
  ).toBeNull()
})

test('a merge conflict makes it yellow', () => {
  expect(pullHealth({ ...clean, mergeableState: 'dirty' })).toBe('conflict')
})
