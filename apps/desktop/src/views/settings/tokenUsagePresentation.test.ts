import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  formatChange,
  formatTokens,
  previousTokenUsageWindow,
  tokenUsageLines,
  tokenUsageSplit,
  tokenUsageWindow,
} from './tokenUsagePresentation.ts'

import type { TeamUsageRow } from '../../types/usage'

const row = (keys: TeamUsageRow['keys'], totalTokens: number, costUsd?: number): TeamUsageRow => ({
  keys,
  inputTokens: totalTokens - 10,
  cachedInputTokens: 0,
  cacheWriteTokens: 0,
  outputTokens: 10,
  reasoningTokens: 0,
  totalTokens,
  ...(costUsd === undefined ? {} : { costUsd }),
})

const names = {
  members: new Map([['u1', 'Ada']]),
  runtimes: new Map([['r1', 'Claude Code on Box']]),
}

test('the window is whole local days and includes today', () => {
  const now = new Date(2026, 10, 18, 15, 30)
  const { from, to } = tokenUsageWindow('7d', now)

  assert.equal(new Date(to).getTime(), new Date(2026, 10, 19).getTime())
  assert.equal(new Date(from).getTime(), new Date(2026, 10, 12).getTime())
})

test('lines are named where the page knows the id, most tokens first', () => {
  const lines = tokenUsageLines(
    [row({ member: 'u2' }, 50), row({ member: 'u1' }, 900, 1.5), row({ member: null }, 20)],
    'member',
    names,
  )

  assert.deepEqual(
    lines.map((line) => [line.label, line.totalTokens, line.costUsd]),
    [
      ['Ada', 900, 1.5],
      ['u2', 50, undefined],
      ['Not recorded', 20, undefined],
    ],
  )
})

test('runtimes are named from the team runtimes; models show as recorded', () => {
  assert.equal(
    tokenUsageLines([row({ runtime: 'r1' }, 1)], 'runtime', names)[0]?.label,
    'Claude Code on Box',
  )
  assert.equal(
    tokenUsageLines([row({ model: 'claude-opus-5-5' }, 1)], 'model', names)[0]?.label,
    'claude-opus-5-5',
  )
})

test('the chart splits by the largest groups, the rest as Other, with every day', () => {
  const window = tokenUsageWindow('7d', new Date(2026, 10, 18, 9))
  const day = new Date(2026, 10, 16).toISOString()
  const rows = ['a', 'b', 'c', 'd', 'e', 'f'].map((member, index) =>
    row({ time: day, member }, (index + 1) * 100),
  )
  const split = tokenUsageSplit(rows, 'member', names, window)

  assert.deepEqual(
    split.series.map((series) => series.label),
    ['f', 'e', 'd', 'c', 'Other'],
  )
  assert.equal(split.points.length, 7)
  assert.deepEqual(split.points[4], {
    at: new Date(2026, 10, 16).getTime(),
    s0: 600,
    s1: 500,
    s2: 400,
    s3: 300,
    other: 300,
  })
  assert.equal(split.total, 2100)
})

test('token counts are shortened', () => {
  assert.deepEqual([999, 1234, 3_400_000, 2_100_000_000].map(formatTokens), [
    '999',
    '1.2K',
    '3.4M',
    '2.1B',
  ])
})

test('the backend’s names win, and each line carries the window before’s total', () => {
  const lines = tokenUsageLines(
    [row({ trigger: 't1' }, 300), row({ trigger: 't2' }, 100)],
    'trigger',
    { ...names, served: { trigger: { t1: 'Nightly report' } } },
    [row({ trigger: 't1' }, 100)],
  )

  assert.deepEqual(
    lines.map((line) => [line.label, formatChange(line)]),
    [
      ['Nightly report', '+200%'],
      ['t2', 'New'],
    ],
  )
})

test('a drop shows as a negative change', () => {
  const [line] = tokenUsageLines([row({ model: 'm' }, 70)], 'model', names, [
    row({ model: 'm' }, 100),
  ])

  assert.equal(line && formatChange(line), '−30%')
})

test('the window before is the same number of whole days, ending where this one starts', () => {
  const window = tokenUsageWindow('7d', new Date(2026, 10, 18, 9))
  const before = previousTokenUsageWindow(window)

  assert.equal(before.to, window.from)
  assert.equal(new Date(before.from).getTime(), new Date(2026, 10, 5).getTime())
})
