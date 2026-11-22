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
  assert.equal(
    summary('0 10 * * *'),
    'Runs every day at 10:00 UTC (18:00 in Asia/Taipei, UTC+8 on 2026-09-21)',
  )
})

test('a viewer on UTC is not told the same time twice', () => {
  assert.equal(summary('0 10 * * *', 'UTC'), 'Runs every day at 10:00 UTC')
})

test('minutes are padded so 9:05 does not read as 9:5', () => {
  assert.equal(
    summary('5 9 * * *'),
    'Runs every day at 09:05 UTC (17:05 in Asia/Taipei, UTC+8 on 2026-09-21)',
  )
})

test('a weekday schedule names its days', () => {
  assert.equal(
    summary('0 10 * * 1-5'),
    'Runs Mon, Tue, Wed, Thu, Fri at 10:00 UTC (18:00 in Asia/Taipei, UTC+8 on 2026-09-21)',
  )
})

test('weekdays shift with the viewer date when the time crosses midnight', () => {
  assert.equal(
    summary('0 20 * * 1,5'),
    'Runs Mon, Fri at 20:00 UTC (Tue, Sat 04:00 in Asia/Taipei, UTC+8 on 2026-09-21)',
  )
  assert.equal(
    summary('0 1 * * 1-5', 'America/Los_Angeles'),
    'Runs Mon, Tue, Wed, Thu, Fri at 01:00 UTC (Mon, Tue, Wed, Thu, Sun 18:00 in America/Los_Angeles, UTC-7 on 2026-09-21)',
  )
  assert.equal(
    summary('0 20 * * 0,1'),
    'Runs Mon, Sun at 20:00 UTC (Mon, Tue 04:00 in Asia/Taipei, UTC+8 on 2026-09-21)',
  )
})

test('an every-N-hours schedule says the interval and where it starts', () => {
  assert.equal(
    summary('0 */6 * * *'),
    'Runs every 6 hours at minute 00, from 00:00 UTC (08:00 in Asia/Taipei, UTC+8 on 2026-09-21)',
  )
})

test('hourly is stated as hourly rather than "every 1 hours"', () => {
  assert.equal(summary('30 * * * *'), 'Runs every hour at minute 30 (UTC)')
  assert.equal(
    summary('30 * * * *', 'Asia/Kolkata'),
    'Runs every hour at minute 30 UTC (minute 00 in Asia/Kolkata, UTC+5:30 on 2026-09-21)',
  )
})

test('an expression the builder cannot read falls back to the expression', () => {
  assert.equal(summary('0 0 1 * 1'), 'Runs on schedule 0 0 1 * 1 (UTC)')
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

test('monthly dates retain the day, clock and authoritative UTC zone', () => {
  assert.equal(
    summary('0 1 1 * *'),
    'Runs on day 1 of each month at 01:00 UTC (09:00 in Asia/Taipei, UTC+8 on 2026-09-21)',
  )
  assert.equal(summary('5 23 31 * *', 'UTC'), 'Runs on day 31 of each month at 23:05 UTC')
})

test('minute intervals are described only when they divide the hour', () => {
  assert.equal(summary('* * * * *'), 'Runs every minute (UTC)')
  for (const n of [2, 3, 4, 5, 6, 10, 12, 15, 20, 30])
    assert.equal(summary(`*/${n} * * * *`), `Runs every ${n} minutes, from minute 00 (UTC)`)
})

test('complex, malformed and resetting intervals preserve the exact expression', () => {
  for (const expression of [
    '*/7 * * * *',
    '*/0 * * * *',
    '0 */5 * * *',
    '0 1 1 * 1',
    '0 1 32 * *',
    '60 1 1 * *',
    '0 24 1 * *',
    '0 1 0 * *',
    '0 1 1 2 *',
    '0 1 L * *',
    '0 0 1 * * *',
    '@monthly',
    '0 1 * * 5-1',
    '-1 1 1 * *',
  ])
    assert.equal(summary(expression), `Runs on schedule ${expression} (UTC)`)
  assert.equal(
    scheduleSummary({
      triggerType: 'cron',
      cronExpression: '0 1 1 * *',
      timeZone: 'America/New_York',
    }),
    'Runs on schedule 0 1 1 * * (America/New_York)',
  )
})

test('local schedule hints name their reference date instead of promising a fixed DST rule', () => {
  const trigger = { triggerType: 'cron' as const, cronExpression: '0 9 1 * *' }

  assert.equal(
    scheduleSummary(trigger, 'America/Los_Angeles', new Date('2026-07-01T12:00Z')),
    'Runs on day 1 of each month at 09:00 UTC (02:00 in America/Los_Angeles, UTC-7 on 2026-07-01)',
  )
  assert.equal(
    scheduleSummary(trigger, 'America/Los_Angeles', new Date('2026-12-01T12:00Z')),
    'Runs on day 1 of each month at 09:00 UTC (01:00 in America/Los_Angeles, UTC-8 on 2026-12-01)',
  )
})

test('the DST offset belongs to the converted clock, not the reference noon', () => {
  assert.equal(
    scheduleSummary(
      { triggerType: 'cron', cronExpression: '0 9 1 * *' },
      'America/Los_Angeles',
      new Date('2026-03-08T12:00Z'),
    ),
    'Runs on day 1 of each month at 09:00 UTC (01:00 in America/Los_Angeles, UTC-8 on 2026-03-08)',
  )
})
