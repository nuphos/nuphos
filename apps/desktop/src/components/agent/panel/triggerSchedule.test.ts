import assert from 'node:assert/strict'
import { test } from 'node:test'

import { cardSchedule } from './triggerSchedule.ts'

const NOW = new Date('2026-10-14T12:00:00Z')
const la = (expr: string) => cardSchedule(expr, 'America/Los_Angeles', NOW)

test('a daily-time schedule leads with local time and groups common day sets', () => {
  assert.equal(la('0 16 * * 1-5'), 'Weekdays at 9:00 AM your time (16:00 UTC)')
  assert.equal(la('30 16 * * *'), 'Every day at 9:30 AM your time (16:30 UTC)')
  assert.equal(la('0 16 * * 0,6'), 'Weekends at 9:00 AM your time (16:00 UTC)')
  assert.equal(la('0 16 * * 1,3'), 'Mon, Wed at 9:00 AM your time (16:00 UTC)')
})

test('days follow the local calendar when the UTC time falls on another day', () => {
  assert.equal(la('0 2 * * 2-6'), 'Weekdays at 7:00 PM your time (02:00 UTC)')
})

test('interval schedules read as intervals', () => {
  assert.equal(la('*/30 * * * *'), 'Every 30 minutes')
  assert.equal(la('* * * * *'), 'Every minute')
  assert.equal(la('0 * * * *'), 'Every hour')
  assert.equal(la('15 */2 * * *'), 'Every 2 hours at :15')
})

test('UTC viewers see one time', () => {
  assert.equal(cardSchedule('0 16 * * 1-5', 'UTC', NOW), 'Weekdays at 16:00 UTC')
})
