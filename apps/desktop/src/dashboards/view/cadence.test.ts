import assert from 'node:assert/strict'
import { test } from 'node:test'

import { describeCadence, describeNextRefresh, nextCadenceRun } from './cadence.ts'

const wednesday = new Date('2026-01-14T12:00:00Z')
const nextRun = (cadence: 'daily' | 'weekly' | 'monthly', now: string) =>
  nextCadenceRun(cadence, new Date(now)).toISOString()

test('next runs land on the fixed UTC schedule, when rolling ranges roll over', () => {
  assert.equal(nextRun('daily', '2026-01-14T12:00:00Z'), '2026-01-15T00:00:00.000Z')
  assert.equal(nextRun('daily', '2026-01-13T23:59:00Z'), '2026-01-14T00:00:00.000Z')
  assert.equal(nextRun('weekly', '2026-01-14T12:00:00Z'), '2026-01-19T00:00:00.000Z')
  assert.equal(nextRun('weekly', '2026-01-19T00:00:00Z'), '2026-01-26T00:00:00.000Z')
  assert.equal(nextRun('monthly', '2026-01-14T12:00:00Z'), '2026-02-01T00:00:00.000Z')
  assert.equal(nextRun('monthly', '2026-12-05T00:00:00Z'), '2027-01-01T00:00:00.000Z')
})

test('a positive-offset viewer sees the same day, later', () => {
  assert.equal(
    describeCadence('daily', wednesday, 'Asia/Taipei'),
    'Daily at 00:00 UTC (08:00 your time)',
  )
  assert.equal(
    describeCadence('weekly', wednesday, 'Pacific/Kiritimati'),
    'Weekly on Monday at 00:00 UTC (Mon 14:00 your time)',
  )
  assert.equal(
    describeCadence('monthly', wednesday, 'Asia/Taipei'),
    'Monthly on the 1st at 00:00 UTC (the 1st at 08:00 your time)',
  )
})

test('a negative-offset viewer sees the previous day', () => {
  assert.equal(
    describeCadence('weekly', wednesday, 'America/Los_Angeles'),
    'Weekly on Monday at 00:00 UTC (Sun 16:00 your time)',
  )
  assert.equal(
    describeCadence('monthly', wednesday, 'Pacific/Honolulu'),
    'Monthly on the 1st at 00:00 UTC (the day before at 14:00 your time)',
  )
})

test('the next refresh shows local and UTC time', () => {
  assert.equal(
    describeNextRefresh('2026-01-19T09:00:00.000Z', 'Pacific/Honolulu'),
    'Next refresh: Sun, Jan 18, 23:00 (Jan 19, 09:00 UTC)',
  )
})
