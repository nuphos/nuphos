import assert from 'node:assert/strict'
import { test } from 'node:test'

import { failingRuns, panelKey, repoKey, toggleItem } from './homeWidgetSettings.ts'

import type { GithubWorkflowRun } from '../../../types'

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

test('failingRuns keeps only failures that are the latest run of their workflow and branch', () => {
  const runs = [
    run(1, 'CI', 'main', '2026-10-01T00:00:00Z', 'failure'),
    run(2, 'CI', 'main', '2026-10-02T00:00:00Z', 'success'),
    run(3, 'CI', 'feat', '2026-10-02T00:00:00Z', 'failure'),
    run(4, 'Lint', 'feat', '2026-10-03T00:00:00Z', 'failure'),
    run(5, 'Lint', 'feat', '2026-10-01T00:00:00Z', 'success'),
    run(6, 'E2E', 'main', '2026-10-03T00:00:00Z', null),
  ]

  assert.deepEqual(
    failingRuns(runs).map((r) => r.id),
    [3, 4],
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
