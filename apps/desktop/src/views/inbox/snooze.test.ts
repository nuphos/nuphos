import assert from 'node:assert/strict'
import test from 'node:test'

import { snoozeTimes } from './snooze.ts'

const at = (day: number, hour: number, minute = 0) => new Date(2026, 10, day, hour, minute)
const times = (now: Date) => snoozeTimes(now).map(({ until }) => until.getTime())

test('snooze offers an hour, tomorrow at 9:00 and next Monday at 9:00, in local time', () => {
  // Tuesday 17 November 2026, 15:30.
  assert.deepEqual(times(at(17, 15, 30)), [
    at(17, 16, 30).getTime(),
    at(18, 9).getTime(),
    at(23, 9).getTime(),
  ])
})

test('on a Monday, next Monday is a week away', () => {
  assert.equal(times(at(16, 10))[2], at(23, 9).getTime())
})

test('on a Sunday, tomorrow is next Monday, offered once', () => {
  assert.deepEqual(times(at(22, 20)), [at(22, 21).getTime(), at(23, 9).getTime()])
})
