import assert from 'node:assert/strict'
import test from 'node:test'

import { scheduleSummary } from './cron.ts'

// The detail page leads with what this trigger does, and a raw cron expression
// is not that. Anything the friendly cron builder can round-trip gets said in
// words; anything it can't falls back to the expression rather than to a
// confident wrong reading of it. The viewer's zone and date are pinned so the
// machine running the tests doesn't decide what "your time" is.

const NOW = new Date('2026-09-21T12:00:00Z')
const summary = (cronExpression: string | undefined, timeZone = 'Asia/Taipei') =>
  scheduleSummary({ triggerType: 'cron', cronExpression }, timeZone, NOW)

test('a daily schedule reads as a UTC time of day with the viewer clock beside it', () => {
  assert.equal(summary('0 10 * * *'), 'Runs every day at 10:00 UTC (18:00 your time)')
})

test('a viewer on UTC is not told the same time twice', () => {
  assert.equal(summary('0 10 * * *', 'UTC'), 'Runs every day at 10:00 UTC')
})

test('minutes are padded so 9:05 does not read as 9:5', () => {
  assert.equal(summary('5 9 * * *'), 'Runs every day at 09:05 UTC (17:05 your time)')
})

test('a weekday schedule names its days', () => {
  assert.equal(
    summary('0 10 * * 1-5'),
    'Runs Mon, Tue, Wed, Thu, Fri at 10:00 UTC (18:00 your time)',
  )
})

test('weekdays shift with the viewer date when the time crosses midnight', () => {
  assert.equal(summary('0 20 * * 1,5'), 'Runs Mon, Fri at 20:00 UTC (Tue, Sat 04:00 your time)')
  assert.equal(
    summary('0 1 * * 1-5', 'America/Los_Angeles'),
    'Runs Mon, Tue, Wed, Thu, Fri at 01:00 UTC (Mon, Tue, Wed, Thu, Sun 18:00 your time)',
  )
  assert.equal(summary('0 20 * * 0,1'), 'Runs Mon, Sun at 20:00 UTC (Mon, Tue 04:00 your time)')
})

test('an every-N-hours schedule says the interval and where it starts', () => {
  assert.equal(
    summary('0 */6 * * *'),
    'Runs every 6 hours at minute 00, from 00:00 UTC (08:00 your time)',
  )
})

test('hourly is stated as hourly rather than "every 1 hours"', () => {
  assert.equal(summary('30 * * * *'), 'Runs every hour at minute 30')
  assert.equal(
    summary('30 * * * *', 'Asia/Kolkata'),
    'Runs every hour at minute 30 (minute 00 your time)',
  )
})

test('an expression the builder cannot read falls back to the expression', () => {
  assert.equal(summary('0 0 1 * *'), 'Runs on schedule 0 0 1 * * (UTC)')
})

test('a webhook trigger says what makes it fire instead', () => {
  assert.equal(
    scheduleSummary({ triggerType: 'webhook' }),
    'Runs when its webhook receives a request',
  )
})

test('a cron trigger with no expression yet claims no schedule', () => {
  assert.equal(summary(undefined), 'No schedule set')
})
