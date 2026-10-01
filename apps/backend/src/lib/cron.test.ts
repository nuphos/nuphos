import { afterEach, describe, expect, test } from 'bun:test'

import { isValidCronExpression, nextCronRun, nextCronRuns } from './cron'

const originalTz = process.env.TZ

afterEach(() => {
  process.env.TZ = originalTz
})

describe('cron', () => {
  test('evaluates in UTC whatever the host zone', () => {
    for (const tz of ['UTC', 'Asia/Taipei', 'America/Los_Angeles']) {
      process.env.TZ = tz
      const next = nextCronRun('0 9 * * *', new Date('2026-09-23T10:00:00Z'))

      expect(next.toISOString()).toBe('2026-09-24T09:00:00.000Z')
    }
  })

  test('previews upcoming runs as UTC instants', () => {
    const runs = nextCronRuns('30 1 * * *', 2)

    expect(runs).toHaveLength(2)
    for (const run of runs) expect(run).toMatch(/T01:30:00\.000Z$/)
  })

  test('accepts only the 5-field form', () => {
    expect(isValidCronExpression('0 9 * * 1-5')).toBe(true)
    expect(isValidCronExpression('0 0 9 * * 1-5')).toBe(false)
    expect(isValidCronExpression('0 25 * * *')).toBe(false)
  })
})
