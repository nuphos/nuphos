import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  cardLabel,
  editableLayout,
  filterPulls,
  filterRuns,
  gridFor,
  mergeRepoReads,
  metricKey,
  panelKey,
  repoKey,
  starterLayout,
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
  const ids = (...statuses: ('failed' | 'running' | 'latest')[]) =>
    filterRuns(runs, statuses)
      .map((r) => r.id)
      .sort()

  assert.deepEqual(ids('failed'), [3, 4])
  assert.deepEqual(ids('running'), [6])
  assert.deepEqual(ids('latest'), [2, 3, 4, 6])
  assert.deepEqual(ids('failed', 'running'), [3, 4, 6])
})

test('filterPulls splits open pull requests into ready and draft', () => {
  const pr = (number: number, draft: boolean) => ({ number, draft }) as GithubPR
  const pulls = [pr(1, false), pr(2, true)]

  assert.deepEqual(
    filterPulls(pulls, ['open']).map((p) => p.number),
    [1, 2],
  )
  assert.deepEqual(
    filterPulls(pulls, ['ready']).map((p) => p.number),
    [1],
  )
  assert.deepEqual(
    filterPulls(pulls, ['draft']).map((p) => p.number),
    [2],
  )
  assert.deepEqual(
    filterPulls(pulls, ['ready', 'draft']).map((p) => p.number),
    [1, 2],
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

test('gridFor keeps saved places, puts new cards in the first free spot, and drops removed ones', () => {
  const grid = gridFor(
    ['team', 'pulls', 'panel:d/p', 'gh:new'],
    [
      { i: 'team', x: 0, y: 0, w: 12, h: 8 },
      { i: 'ci', x: 6, y: 8, w: 6, h: 7 },
    ],
  )

  assert.deepEqual(grid, [
    { i: 'team', x: 0, y: 0, w: 12, h: 8 },
    // The removed CI card's place is free again, so the panel moves in beside
    // the pull requests instead of going below them.
    { i: 'pulls', x: 0, y: 8, w: 6, h: 7 },
    { i: 'panel:d/p', x: 6, y: 8, w: 6, h: 6 },
    // Under the shorter panel, which frees up first.
    { i: 'gh:new', x: 6, y: 14, w: 6, h: 7 },
  ])
})

test('gridFor puts a new card beside a half-width one rather than below it', () => {
  const grid = gridFor(
    ['team', 'gh:prs', 'gh:ci'],
    [
      { i: 'team', x: 0, y: 0, w: 12, h: 8 },
      { i: 'gh:prs', x: 0, y: 8, w: 6, h: 7 },
    ],
  )

  assert.deepEqual(grid[2], { i: 'gh:ci', x: 6, y: 8, w: 6, h: 7 })
})

test('gridFor grows a saved card that was resized below its minimum', () => {
  const grid = gridFor(
    ['team', 'gh:prs'],
    [
      { i: 'team', x: 0, y: 0, w: 12, h: 1 },
      { i: 'gh:prs', x: 0, y: 1, w: 1, h: 1 },
    ],
  )

  assert.deepEqual(grid, [
    { i: 'team', x: 0, y: 0, w: 12, h: 4 },
    { i: 'gh:prs', x: 0, y: 1, w: 3, h: 3 },
  ])
})

test('cardLabel names each kind of card', () => {
  const layout = {
    team: true,
    github: [{ id: 'x', kind: 'ci' as const, repos: [], statuses: ['failed' as const] }],
    panels: [{ dashboardId: 'd', panelId: 'p' }],
  }

  assert.equal(cardLabel(layout, 'team'), 'Team activity')
  assert.equal(cardLabel(layout, 'gh:x'), 'CI · Failing')
  assert.equal(cardLabel(layout, 'panel:d/p'), 'Dashboard panel')
  // A metric card's grip reads by its title, never its key.
  assert.equal(cardLabel(layout, 'metric:streak:m1'), 'Streak')
  assert.equal(cardLabel(layout, 'metric:runtime-mix:m2'), 'Runtime mix')
})

test('a layout that failed to load is not editable', () => {
  assert.equal(editableLayout(null), null)
  assert.deepEqual(editableLayout({ personal: null, team: null }), {
    team: true,
    github: [],
    panels: [],
    metrics: [],
  })
})

test('metric cards take half a row, as tall as their content, and old layouts have none', () => {
  const streak = { id: 'm1', kind: 'streak', range: '7d', scope: 'me' } as const
  const runs = { id: 'm2', kind: 'runtime-mix', range: '1d', scope: 'team' } as const

  assert.deepEqual(gridFor([metricKey(streak), metricKey(runs)]), [
    { i: 'metric:streak:m1', x: 0, y: 0, w: 6, h: 3 },
    { i: 'metric:runtime-mix:m2', x: 6, y: 0, w: 6, h: 4 },
  ])
  assert.deepEqual(
    gridFor(['metric:streak:m1'], [{ i: 'metric:streak:m1', x: 0, y: 0, w: 2, h: 2 }]),
    [{ i: 'metric:streak:m1', x: 0, y: 0, w: 4, h: 3 }],
  )
  const saved = { team: true, github: [], panels: [] }

  assert.deepEqual(editableLayout({ personal: saved, team: null })?.metrics, [])
  assert.deepEqual(
    editableLayout({ personal: { ...saved, metrics: [streak] }, team: null })?.metrics,
    [streak],
  )
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
    metrics: [],
  })
  assert.deepEqual(starterLayout({ repo, hasPulls: false, hasRuns: true, panels: [pin] }), {
    team: true,
    github: [{ id: 'starter-ci', kind: 'ci', repos: [repo], statuses: ['latest'] }],
    panels: [pin],
    metrics: [],
  })
  assert.equal(starterLayout({ repo, hasPulls: true, hasRuns: true, panels: [] }).github.length, 2)
})
