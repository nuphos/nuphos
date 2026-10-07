import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  editableLayout,
  filterPulls,
  filterRuns,
  gridFor,
  starterLayout,
  mergeRepoReads,
  panelKey,
  repoKey,
  toggleItem,
} from './homeWidgetSettings.ts'

import type { GithubPR, GithubWorkflowRun } from '../../../types'

const run = (
  id: number,
  name: string,
  headBranch: string,
  createdAt: string,
  conclusion: string | null,
): GithubWorkflowRun => ({
  id,
  name,
  headBranch,
  createdAt,
  conclusion,
  status: conclusion ? 'completed' : 'in_progress',
  event: 'push',
  headSha: String(id),
  updatedAt: createdAt,
  htmlUrl: `https://github.com/o/r/actions/runs/${String(id)}`,
})

test('filterRuns looks only at the latest run of each workflow and branch', () => {
  const runs = [
    run(1, 'CI', 'main', '2026-10-01T00:00:00Z', 'failure'),
    run(2, 'CI', 'main', '2026-10-02T00:00:00Z', 'success'),
    run(3, 'CI', 'feat', '2026-10-02T00:00:00Z', 'failure'),
    run(4, 'Lint', 'feat', '2026-10-03T00:00:00Z', 'failure'),
    run(5, 'Lint', 'feat', '2026-10-01T00:00:00Z', 'success'),
    run(6, 'E2E', 'main', '2026-10-03T00:00:00Z', null),
  ]
  const ids = (status: 'failed' | 'running' | 'latest') =>
    filterRuns(runs, status)
      .map((r) => r.id)
      .sort()

  assert.deepEqual(ids('failed'), [3, 4])
  assert.deepEqual(ids('running'), [6])
  assert.deepEqual(ids('latest'), [2, 3, 4, 6])
})

test('filterPulls splits open pull requests into ready and draft', () => {
  const pr = (number: number, draft: boolean) => ({ number, draft }) as GithubPR
  const pulls = [pr(1, false), pr(2, true)]

  assert.deepEqual(
    filterPulls(pulls, 'open').map((p) => p.number),
    [1, 2],
  )
  assert.deepEqual(
    filterPulls(pulls, 'ready').map((p) => p.number),
    [1],
  )
  assert.deepEqual(
    filterPulls(pulls, 'draft').map((p) => p.number),
    [2],
  )
})

test('toggleItem adds a missing entry and removes a present one by key', () => {
  const a = { installationId: 1, fullName: 'o/a' }
  const b = { installationId: 1, fullName: 'o/b' }

  assert.deepEqual(toggleItem([a], b, repoKey), [a, b])
  assert.deepEqual(toggleItem([a, b], { ...a }, repoKey), [b])

  const p = { dashboardId: 'd1', panelId: 'p1' }
  const q = { dashboardId: 'd2', panelId: 'p1' }

  assert.deepEqual(toggleItem([p], q, panelKey), [p, q])
  assert.deepEqual(toggleItem([p, q], { ...p }, panelKey), [q])
})

test('gridFor keeps saved places, appends new cards below, and drops removed ones', () => {
  const grid = gridFor(
    ['team', 'pulls', 'panel:d/p'],
    [
      { i: 'team', x: 0, y: 0, w: 12, h: 8 },
      { i: 'ci', x: 6, y: 8, w: 6, h: 7 },
    ],
  )

  assert.deepEqual(grid, [
    { i: 'team', x: 0, y: 0, w: 12, h: 8 },
    { i: 'pulls', x: 0, y: 8, w: 6, h: 7 },
    { i: 'panel:d/p', x: 0, y: 15, w: 6, h: 6 },
  ])
})

test('a layout that failed to load is not editable', () => {
  assert.equal(editableLayout(null), null)
  assert.deepEqual(editableLayout({ personal: null, team: null }), {
    team: true,
    github: [],
    panels: [],
  })
})

test('a failed repository read keeps its last rows and is reported', () => {
  const first = mergeRepoReads(new Map(), [
    { repo: 'o/a', items: [1] },
    { repo: 'o/b', items: [2] },
  ])
  const second = mergeRepoReads(first.byRepo, [
    { repo: 'o/a', items: null },
    { repo: 'o/b', items: [3] },
  ])

  assert.deepEqual(
    [...second.byRepo],
    [
      ['o/a', [1]],
      ['o/b', [3]],
    ],
  )
  assert.deepEqual(second.failed, ['o/a'])
  assert.deepEqual(mergeRepoReads(new Map(), [{ repo: 'o/c', items: null }]).failed, ['o/c'])
})

test('a starter layout adds only what the team already has data for', () => {
  const repo = { installationId: 1, fullName: 'o/app' }
  const pin = { dashboardId: 'd', panelId: 'p' }

  assert.deepEqual(starterLayout({ repo: null, hasPulls: false, hasRuns: false, panels: [] }), {
    team: true,
    github: [],
    panels: [],
  })
  assert.deepEqual(starterLayout({ repo, hasPulls: false, hasRuns: true, panels: [pin] }), {
    team: true,
    github: [{ id: 'starter-ci', kind: 'ci', repos: [repo], status: 'latest' }],
    panels: [pin],
  })
  assert.equal(starterLayout({ repo, hasPulls: true, hasRuns: true, panels: [] }).github.length, 2)
})
