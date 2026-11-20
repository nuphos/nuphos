import { expect, test } from 'bun:test'

import { triggerScheduleDescription } from './schedule-description'

test('describes common schedules and keeps UTC explicit', () => {
  const describe = (cronExpression: string) =>
    triggerScheduleDescription({ triggerType: 'cron', cronExpression })

  expect(describe('0 * * * *')).toBe('Every hour at minute 00')
  expect(describe('30 9 * * 1-5')).toBe('Weekdays at 09:30 UTC')
  expect(describe('*/15 * * * *')).toBe('Every 15 minutes')
  expect(describe('0 */4 * * *')).toBe('Every 4 hours at minute 00 (UTC)')
  expect(describe('0 9-18 * * *')).toContain('9:00 – 18:00 UTC')
  expect(describe('0 9 1 * *')).toBe('Schedule: 0 9 1 * * (UTC)')
  // #4109: a weekly schedule read as raw cron.
  expect(describe('0 9 * * 1')).toBe('Every Monday at 09:00 UTC')
  expect(describe('0 9 * * 7')).toBe('Every Sunday at 09:00 UTC')
  expect(describe('30 17 * * 2,4')).toBe('Every Tuesday and Thursday at 17:30 UTC')
  expect(describe('0 8 * * 1,3,5')).toBe('Every Monday, Wednesday and Friday at 08:00 UTC')
  expect(triggerScheduleDescription({ triggerType: 'webhook' })).toBe('When a webhook arrives')
})

test('a named schedule zone is preserved in the conversation description', () => {
  expect(
    triggerScheduleDescription({
      triggerType: 'cron',
      cronExpression: '30 9 * * 1-5',
      timeZone: 'America/New_York',
    }),
  ).toBe('Weekdays at 09:30 America/New_York')
})
