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
