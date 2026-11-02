import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  changePercent,
  formatDuration,
  formatHours,
  metricSize,
  metricTitle,
  roundSensibly,
  runtimeShares,
  workdays,
} from './homeMetricFormat.ts'

const MIN = 60_000
const HOUR = 60 * MIN

test('numbers keep one decimal under 10 and none from there', () => {
  assert.equal(roundSensibly(2.44), 2.4)
  assert.equal(roundSensibly(9.96), 10)
  assert.equal(roundSensibly(12.4), 12)
  assert.deepEqual(formatHours(42 * MIN), { value: '42', unit: 'min' })
  assert.deepEqual(formatHours(3.24 * HOUR), { value: '3.2', unit: 'h' })
  assert.deepEqual(formatHours(18.6 * HOUR), { value: '19', unit: 'h' })
  assert.equal(formatDuration(45 * MIN), '45 min')
  assert.equal(formatDuration(3 * HOUR + 12 * MIN), '3 h 12 min')
})

test('human time divides turn time by an 8 hour workday', () => {
  assert.equal(workdays(8 * HOUR), 'About 1 workday of human time')
  assert.equal(workdays(19 * HOUR), 'About 2.4 workdays of human time')
  assert.equal(workdays(100 * HOUR), 'About 13 workdays of human time')
})

test('the trend compares with the period before, if it had any', () => {
  assert.equal(changePercent(15, 10), 50)
  assert.equal(changePercent(5, 10), -50)
  assert.equal(changePercent(5, 0), null)
})

test('every kind of metric card has a title', () => {
  assert.equal(metricTitle('streak'), 'Streak')
  assert.equal(metricTitle('runtime-mix'), 'Runtime mix')
})

test('a card with one line under its number is a row shorter', () => {
  assert.deepEqual(metricSize('streak'), { w: 6, h: 3 })
  assert.deepEqual(metricSize('runtime-mix'), { w: 6, h: 4 })
})

test('runtime shares add up to exactly 100', () => {
  const shares = runtimeShares([
    { runtime: 'claude-code', agentMs: 2 },
    { runtime: 'codex', agentMs: 1 },
  ])

  assert.deepEqual(
    shares.map((s) => s.percent),
    [67, 33],
  )
  assert.deepEqual(runtimeShares([]), [])
})
