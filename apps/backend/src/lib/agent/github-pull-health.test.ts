import { expect, test } from 'bun:test'

import { pullHealth, settledCi } from './github-pull-health'

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

const run = (id: number, status: string, conclusion: string | null) => ({
  id,
  name: `job-${String(id)}`,
  status,
  conclusion,
})

test('CI settles only when no run is unfinished and no status is pending', () => {
  const sha = 'a'.repeat(40)

  expect(settledCi(sha, [], [])).toBeNull()
  expect(settledCi(sha, [run(1, 'completed', 'success'), run(2, 'queued', null)], [])).toBeNull()
  expect(
    settledCi(sha, [run(1, 'completed', 'success')], [{ id: 5, context: 'ci', state: 'pending' }]),
  ).toBeNull()
  expect(
    settledCi(
      sha,
      [run(2, 'completed', 'failure'), run(1, 'completed', 'skipped')],
      [{ id: 5, context: 'council', state: 'error' }],
    ),
  ).toEqual({ id: 'r1,r2,s5', summary: 'GitHub CI finished on aaaaaaa: failed (job-2, council).' })
})

test('a run replaced on the same commit no longer counts, but a cancelled run nothing replaced fails', () => {
  const sha = 'a'.repeat(40)
  const lint = (id: number, conclusion: string) => ({
    id,
    name: 'Lint',
    status: 'completed',
    conclusion,
  })

  // cancel-in-progress stopped the first run when another one started on this commit.
  expect(settledCi(sha, [lint(1, 'cancelled'), lint(2, 'success')], [])).toEqual({
    id: 'r2',
    summary: 'GitHub CI finished on aaaaaaa: passed.',
  })
  expect(settledCi(sha, [lint(2, 'cancelled')], [])?.summary).toBe(
    'GitHub CI finished on aaaaaaa: failed (Lint).',
  )
})
