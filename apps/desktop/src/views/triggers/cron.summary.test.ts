import assert from 'node:assert/strict'
import test from 'node:test'

import { scheduleSummary } from './cron.ts'

const summary = (cronExpression: string, timeZone = 'UTC') =>
  scheduleSummary({ triggerType: 'cron', cronExpression, timeZone })

test('monthly descriptions retain the stored calendar day and timezone', () => {
  assert.equal(summary('0 1 1 * *'), 'Runs on day 1 of each month at 01:00 UTC')
  assert.equal(
    summary('0 1 1 * *', 'America/New_York'),
    'Runs on day 1 of each month at 01:00 America/New_York',
  )
  for (const day of [29, 30, 31])
    assert.equal(
      summary(`5 23 ${day} * *`),
      `Runs on day ${day} of each month at 23:05 UTC; skips months without that date`,
    )
})

test('daily, weekday lists and hourly schedules use their source clock', () => {
  assert.equal(summary('5 9 * * *'), 'Runs every day at 09:05 UTC')
  assert.equal(summary('0 20 * * 1,5'), 'Runs Mon, Fri at 20:00 UTC')
  assert.equal(summary('0 10 * * 1-5'), 'Runs Mon, Tue, Wed, Thu, Fri at 10:00 UTC')
  assert.equal(summary('30 * * * *'), 'Runs every hour at minute 30 (UTC)')
  assert.equal(summary('0 */6 * * *'), 'Runs every 6 hours at minute 00, from 00:00 UTC')
})

test('minute intervals divide a full hour rather than resetting unevenly', () => {
  assert.equal(summary('* * * * *'), 'Runs every minute (UTC)')
  for (const n of [2, 3, 4, 5, 6, 10, 12, 15, 20, 30])
    assert.equal(summary(`*/${n} * * * *`), `Runs every ${n} minutes, from minute 00 (UTC)`)
})

test('complex and invalid patterns preserve the expression and source timezone', () => {
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
    summary('0 1 L * *', 'America/New_York'),
    'Runs on schedule 0 1 L * * (America/New_York)',
  )
})

test('webhooks and missing schedules retain their status text', () => {
  assert.equal(
    scheduleSummary({ triggerType: 'webhook' }),
    'Runs when its webhook receives a request',
  )
  assert.equal(scheduleSummary({ triggerType: 'cron' }), 'No schedule set')
})
