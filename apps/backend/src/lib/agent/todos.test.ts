import { expect, test } from 'bun:test'

import { pendingLine } from './todos'

const now = new Date('2026-11-24T12:00:00.000Z')
const hoursAgo = (n: number) => new Date(now.getTime() - n * 3_600_000)

test('names each kind with its count and its oldest wait', () => {
  expect(pendingLine([hoursAgo(26), hoursAgo(2)], [hoursAgo(4)], now)).toBe(
    'Pending: inbox 2 (oldest 26h), todos 1 (oldest 4h).',
  )
})

test('leaves out a kind with nothing open, and the line when neither has', () => {
  expect(pendingLine([], [hoursAgo(3), hoursAgo(1)], now)).toBe('Pending: todos 2 (oldest 3h).')
  expect(pendingLine([], [], now)).toBeNull()
})

test('a wait under an hour reads as <1h', () => {
  expect(pendingLine([hoursAgo(0.5)], [], now)).toBe('Pending: inbox 1 (oldest <1h).')
})
