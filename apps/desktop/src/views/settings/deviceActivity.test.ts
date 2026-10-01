import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  commandPreview,
  formatActivityTime,
  formatDuration,
  originLabel,
  outcomeSummary,
} from './deviceActivity.ts'

test('outcomeSummary distinguishes a clean exit, a failing exit and non-runs', () => {
  assert.deepEqual(outcomeSummary({ outcome: 'ok', exitCode: 0 }), {
    label: 'Exit 0',
    tone: 'success',
  })
  assert.deepEqual(outcomeSummary({ outcome: 'ok', exitCode: 2 }), {
    label: 'Exit 2',
    tone: 'warning',
  })
  assert.deepEqual(outcomeSummary({ outcome: 'timeout', exitCode: null }), {
    label: 'Timed out',
    tone: 'error',
  })
  assert.deepEqual(outcomeSummary({ outcome: 'device_offline', exitCode: null }), {
    label: 'Device offline',
    tone: 'error',
  })
  assert.deepEqual(outcomeSummary({ outcome: 'rejected', exitCode: null }), {
    label: 'Not run',
    tone: 'muted',
  })
  assert.deepEqual(outcomeSummary({ outcome: 'error', exitCode: null }), {
    label: 'Failed',
    tone: 'error',
  })
})

test('originLabel names who started the turn', () => {
  assert.equal(originLabel('user'), 'You')
  assert.equal(originLabel('trigger'), 'Trigger')
  assert.equal(originLabel('automation'), 'Scheduled task')
  assert.equal(originLabel('database-alert'), 'Database alert')
})

test('formatDuration scales from milliseconds to minutes', () => {
  assert.equal(formatDuration(0), '0 ms')
  assert.equal(formatDuration(850), '850 ms')
  assert.equal(formatDuration(2500), '2.5 s')
  assert.equal(formatDuration(42_000), '42 s')
  assert.equal(formatDuration(65_000), '1m 05s')
})

test('commandPreview keeps short commands and truncates long or multi-line ones', () => {
  assert.deepEqual(commandPreview('git status'), { text: 'git status', truncated: false })
  assert.deepEqual(commandPreview('abcdefghij', 5), { text: 'abcde…', truncated: true })
  assert.deepEqual(commandPreview('echo one\necho two'), { text: 'echo one…', truncated: true })
})

test('formatActivityTime is relative within a day', () => {
  const now = new Date('2026-09-23T12:00:00.000Z')

  assert.equal(formatActivityTime('2026-09-23T11:59:30.000Z', now), 'Just now')
  assert.equal(formatActivityTime('2026-09-23T11:45:00.000Z', now), '15m ago')
  assert.equal(formatActivityTime('2026-09-23T09:00:00.000Z', now), '3h ago')
  assert.notEqual(formatActivityTime('2026-09-20T09:00:00.000Z', now), '')
  assert.equal(formatActivityTime('not a date', now), '')
})
