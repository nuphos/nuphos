import { expect, test } from 'bun:test'

import { parseUtcCron, spreadWithinMinute } from './cron'

const ids = Array.from({ length: 200 }, (_, i) => `6a${i.toString(16).padStart(22, '0')}`)
const seconds = (pattern: string) => Number(pattern.split(' ')[0])

test('a Trigger keeps the same second on every schedule, and Triggers spread over 0-50s', () => {
  const spread = ids.map((id) => seconds(spreadWithinMinute(id, '0 * * * *')))

  expect(ids.map((id) => seconds(spreadWithinMinute(id, '0 * * * *')))).toEqual(spread)
  expect(spread.every((second) => Number.isInteger(second) && second >= 0 && second <= 50)).toBe(
    true,
  )
  // Hourly Triggers no longer share one instant.
  expect(new Set(spread).size).toBeGreaterThan(30)
})

test('it still fires within the scheduled minute', () => {
  const from = new Date('2026-11-17T02:59:30.000Z')

  for (const id of ids.slice(0, 20)) {
    const pattern = spreadWithinMinute(id, '0 * * * *')
    const next = parseUtcCron(pattern, from).next().toDate()

    expect(next.toISOString().slice(0, 16)).toBe('2026-11-17T03:00')
    expect(next.getUTCSeconds()).toBe(seconds(pattern))
  }
})

test('the schedule itself is kept as written', () => {
  expect(spreadWithinMinute(ids[0]!, '15 9 * * 1-5').split(' ').slice(1).join(' ')).toBe(
    '15 9 * * 1-5',
  )
})
