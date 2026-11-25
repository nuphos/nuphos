import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  WEEK_MS,
  atLimitHours,
  readingGaps,
  weeklyPace,
  weeklyPoints,
  weeklyWindow,
} from './weeklyPace.ts'

import type { RuntimeQuota } from '../../types/runtime'

const HOUR = 3_600_000
const now = Date.parse('2026-11-27T11:00:00.000Z')
// Reset four days ago, so three days remain.
const resetsAt = new Date(now + 3 * 24 * HOUR).toISOString()
const start = Date.parse(resetsAt) - WEEK_MS
const weekly = (usedPercent: number) => ({
  id: 'seven_day',
  label: 'Weekly',
  usedPercent,
  resetsAt,
})
const hourly = (values: (number | null)[], from = start) =>
  values.map((value, i) => ({ at: from + i * HOUR, value }))

test('the weekly window is the one the chart draws', () => {
  const quota = {
    available: true,
    windows: [{ id: 'five_hour', label: '5-hour', usedPercent: 90, resetsAt }, weekly(40)],
  } as RuntimeQuota

  assert.equal(weeklyWindow(quota, now)?.id, 'seven_day')
  assert.equal(weeklyWindow({ ...quota, available: false }, now), null)
  // Read before a reset that has since passed: that week is over.
  assert.equal(weeklyWindow(quota, Date.parse(resetsAt) + 1), null)
})

test('a pace that spends the rest before the reset says when it runs out', () => {
  // 70% in four days runs out after 100 / 70 * 4 days, under the week.
  const pace = weeklyPace(weekly(70), hourly([10, 30, 50, 70]), now)

  assert.equal(pace.kind, 'runsOut')
  assert.equal(pace.kind === 'runsOut' && pace.at, start + (100 / 70) * 4 * 24 * HOUR)
})

test('a pace that lasts the week says how much the reset finds used', () => {
  // 40% in four days is 70% over seven.
  assert.deepEqual(weeklyPace(weekly(40), hourly([10, 20, 40]), now), {
    kind: 'onPace',
    atReset: 70,
  })
})

test('too few readings since the reset give no pace', () => {
  // The readings before the reset do not count.
  const points = hourly([50, 60, 70, 10, 20], start - 3 * HOUR)

  assert.deepEqual(weeklyPace(weekly(20), points, now), { kind: 'tooFew' })
})

test('a used-up window says since when, from the stretch still at the limit', () => {
  const points = hourly([40, 100, 90, null, 100, 100])

  assert.deepEqual(weeklyPace(weekly(100), points, now), {
    kind: 'usedUp',
    since: start + 4 * HOUR,
  })
  assert.deepEqual(weeklyPace(weekly(100), [], now), { kind: 'usedUp', since: null })
})

test('hours at a limit count only the hours read at it', () => {
  assert.equal(atLimitHours(hourly([100, 100, null, 99, 100])), 3)
  assert.equal(atLimitHours(hourly([null, 20])), 0)
})

test('every hour of the week is on the axis, read from that window only', () => {
  const points = weeklyPoints(
    [
      {
        runtimeId: 'a',
        windowId: 'seven_day',
        label: 'Weekly',
        points: [{ at: '2026-11-27T10:00:00.000Z', usedPercent: 40 }],
      },
      {
        runtimeId: 'a',
        windowId: 'five_hour',
        label: '5-hour',
        points: [{ at: '2026-11-27T09:00:00.000Z', usedPercent: 90 }],
      },
    ],
    'a',
    'seven_day',
    now,
  )

  assert.equal(points.length, 7 * 24 + 1)
  assert.deepEqual(
    points.filter((p) => p.value !== null),
    [{ at: Date.parse('2026-11-27T10:00:00.000Z'), value: 40 }],
  )
})

test('each stretch nobody read is one gap', () => {
  assert.deepEqual(readingGaps(hourly([null, null, 5, null], 0), 10 * HOUR), [
    { from: 0, to: 2 * HOUR },
    { from: 3 * HOUR, to: 10 * HOUR },
  ])
})
