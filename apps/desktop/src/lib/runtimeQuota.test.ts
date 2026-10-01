import assert from 'node:assert/strict'
import test from 'node:test'

import {
  formatResetsAt,
  quotaDetailLines,
  quotaNote,
  quotaSummary,
  quotaTone,
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
  assert.match(lines[0] ?? '', /^5-hour: 38% used · resets in 2h 10m \(/u)
  assert.match(lines[1] ?? '', /^Weekly: 12% used · resets /u)
  assert.equal(lines[2], 'Other: 5% used')
})

test('reset formatting edge cases', () => {
  assert.equal(formatResetsAt(null, now), null)
  assert.equal(formatResetsAt('garbage', now), null)
  assert.equal(formatResetsAt('2026-09-15T12:00:00Z', now), 'resets now')
  assert.match(formatResetsAt('2026-09-15T12:45:00Z', now) ?? '', /^resets in 25m \(/u)
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
