import { expect, test } from 'bun:test'

import { createTodoTools, pendingLine } from './todos'

const now = new Date('2026-11-24T12:00:00.000Z')
const hoursAgo = (n: number) => new Date(now.getTime() - n * 3_600_000)
const none = { count: 0 }

test('names each kind with its count and its oldest wait', () => {
  expect(
    pendingLine({ count: 2, oldest: hoursAgo(26) }, { count: 1, oldest: hoursAgo(4) }, now),
  ).toBe('Pending: inbox 2 (oldest 26h), todos 1 (oldest 4h).')
})

test('leaves out a kind with nothing open, and the line when neither has', () => {
  expect(pendingLine(none, { count: 2, oldest: hoursAgo(3) }, now)).toBe(
    'Pending: todos 2 (oldest 3h).',
  )
  expect(pendingLine(none, none, now)).toBeNull()
})

test('a wait under an hour reads as <1h', () => {
  expect(pendingLine({ count: 1, oldest: hoursAgo(0.5) }, none, now)).toBe(
    'Pending: inbox 1 (oldest <1h).',
  )
})

test('a conversation outside a team gets no to-do tool', () => {
  expect(createTodoTools('u', 's', null)).toEqual({})
  expect(Object.keys(createTodoTools('u', 's', 't'))).toEqual(['todos'])
})
