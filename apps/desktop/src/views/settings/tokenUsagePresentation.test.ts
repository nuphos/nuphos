import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  formatTokens,
  tokenUsageDays,
  tokenUsageLines,
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

test('every day of the window has a point, zero where nothing was used', () => {
  const window = tokenUsageWindow('7d', new Date(2026, 10, 18, 9))
  const used = new Date(2026, 10, 16).toISOString()
  const points = tokenUsageDays([row({ time: used }, 4200)], window)

  assert.equal(points.length, 7)
  assert.deepEqual(
    points.map((point) => point.value),
    [0, 0, 0, 0, 4200, 0, 0],
  )
})

test('token counts are shortened', () => {
  assert.deepEqual([999, 1234, 3_400_000, 2_100_000_000].map(formatTokens), [
    '999',
    '1.2K',
    '3.4M',
    '2.1B',
  ])
})
