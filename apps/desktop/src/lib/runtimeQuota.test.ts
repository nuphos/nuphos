import assert from 'node:assert/strict'
import test from 'node:test'

import {
  formatResetsDuration,
  formatResetsIn,
  quotaDetailLines,
  quotaNote,
  quotaSharedWith,
  quotaSignedOut,
  quotaSummary,
  quotaTone,
  quotaWindowTone,
} from './runtimeQuota.ts'

import type { RuntimeQuota } from '../types/runtime.ts'

const now = new Date('2026-09-15T12:20:00Z')

function quota(windows: RuntimeQuota['windows'], available = true): RuntimeQuota {
  return {
    runtimeId: 'r1',
    provider: 'claude-code',
    fetchedAt: now.toISOString(),
    available,
    windows,
  }
}

test('summary follows the most constrained window', () => {
  const q = quota([
    { id: 'five_hour', label: '5-hour', usedPercent: 38, resetsAt: null },
    { id: 'seven_day', label: 'Weekly', usedPercent: 62.4, resetsAt: null },
  ])

  assert.equal(quotaSummary(q), '37% left')
  assert.equal(quotaTone(q), 'ok')
})

test('exhausted and warning tones', () => {
  assert.equal(
    quotaSummary(quota([{ id: 'a', label: 'A', usedPercent: 100, resetsAt: null }])),
    '0% left',
  )
  assert.equal(
    quotaTone(quota([{ id: 'a', label: 'A', usedPercent: 100, resetsAt: null }])),
    'exhausted',
  )
  assert.equal(
    quotaTone(quota([{ id: 'a', label: 'A', usedPercent: 80, resetsAt: null }])),
    'warning',
  )
})

test('each window carries its own tone', () => {
  const tones = [79, 80, 100].map((usedPercent) =>
    quotaWindowTone({ id: 'a', label: 'A', usedPercent, resetsAt: null }),
  )

  assert.deepEqual(tones, ['ok', 'warning', 'exhausted'])
})

test('unavailable quota has no summary or details', () => {
  assert.equal(quotaSummary(quota([], false)), null)
  assert.equal(quotaSummary(undefined), null)
  assert.deepEqual(quotaDetailLines(quota([], false), now), [])
})

test('detail lines carry usage and reset timing', () => {
  const lines = quotaDetailLines(
    quota([
      { id: 'five_hour', label: '5-hour', usedPercent: 38, resetsAt: '2026-09-15T14:30:00Z' },
      { id: 'seven_day', label: 'Weekly', usedPercent: 12, resetsAt: '2026-09-18T09:00:00Z' },
      { id: 'x', label: 'Other', usedPercent: 5, resetsAt: null },
    ]),
    now,
  )

  assert.equal(lines.length, 3)
  assert.equal(lines[0], '5-hour: 62% left · resets in 2h 10m')
  assert.equal(lines[1], 'Weekly: 88% left · resets in 2d 20h')
  assert.equal(lines[2], 'Other: 95% left')
})

test('resets in: days and hours, then hours and minutes, then minutes', () => {
  const at = (minutes: number) => new Date(now.getTime() + minutes * 60_000).toISOString()

  assert.equal(formatResetsIn(at(2 * 1440 + 5 * 60 + 59), now), 'resets in 2d 5h')
  assert.equal(formatResetsIn(at(1440), now), 'resets in 1d 0h')
  assert.equal(formatResetsIn(at(3 * 60 + 20), now), 'resets in 3h 20m')
  assert.equal(formatResetsIn(at(60), now), 'resets in 1h 0m')
  assert.equal(formatResetsIn(at(12), now), 'resets in 12m')
  // Under a minute still reads as a minute away, never as "0m".
  assert.equal(formatResetsIn(at(0.25), now), 'resets in 1m')
})

test('the bare duration is what follows "resets in"', () => {
  const at = new Date(now.getTime() + (2 * 1440 + 5 * 60) * 60_000).toISOString()

  assert.equal(formatResetsDuration(at, now), '2d 5h')
  assert.equal(formatResetsDuration(null, now), null)
})

test('resets in is hidden when the reset is unknown or past', () => {
  assert.equal(formatResetsIn(null, now), null)
  assert.equal(formatResetsIn(undefined, now), null)
  assert.equal(formatResetsIn('garbage', now), null)
  assert.equal(formatResetsIn(now.toISOString(), now), null)
  assert.equal(formatResetsIn('2026-09-15T11:00:00Z', now), null)
})

test('an unavailable quota shows the reason the agent gave, and nothing else does', () => {
  const offline: RuntimeQuota = {
    runtimeId: 'r1',
    provider: 'claude-code',
    fetchedAt: now.toISOString(),
    available: false,
    reason: 'Sign in required',
    windows: [],
  }

  assert.equal(quotaNote(offline), 'Sign in required')
  assert.equal(quotaSummary(offline), null)
  assert.equal(quotaNote({ ...offline, reason: undefined }), null)
  assert.equal(quotaNote(undefined), null)
  assert.equal(
    quotaNote(quota([{ id: 'seven_day', label: 'Weekly', usedPercent: 12, resetsAt: null }])),
    null,
  )
})

test('only the probe finding no sign-in reads as signed out', () => {
  const signedOut: RuntimeQuota = { ...quota([], false), reason: 'Sign in required' }

  assert.equal(quotaSignedOut(signedOut), true)
  assert.equal(quotaSignedOut({ ...signedOut, reason: 'HTTP 401' }), false)
  assert.equal(quotaSignedOut({ ...signedOut, reason: 'Usage lookup failed' }), false)
  assert.equal(quotaSignedOut({ ...signedOut, available: true }), false)
  assert.equal(quotaSignedOut(undefined), false)
})

test('names the agents that spend the same account, and nothing for one alone', () => {
  const base = {
    runtimeId: 'a',
    provider: 'claude-code' as const,
    fetchedAt: '2026-11-17T00:00:00Z',
    available: true,
    windows: [],
  }

  assert.equal(quotaSharedWith(base), null)
  assert.equal(quotaSharedWith(undefined), null)
  assert.equal(
    quotaSharedWith({
      ...base,
      sharesQuotaWith: [
        { runtimeId: 'b', label: 'Yuanlin (20x) in Box' },
        { runtimeId: 'c', label: 'Claude in Mac' },
      ],
    }),
    'Shares quota with Yuanlin (20x) in Box, Claude in Mac',
  )
})
