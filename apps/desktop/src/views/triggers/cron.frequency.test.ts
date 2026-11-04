import assert from 'node:assert/strict'
import test from 'node:test'

import { firesHourlyOrMore } from './cron.ts'

test('hourly, sub-hourly and hourly-within-a-window schedules count as frequent', () => {
  for (const expr of ['5 * * * *', '*/30 * * * *', '0,30 9 * * *', '0 0-15 * * *', '0 */1 * * *'])
    assert.equal(firesHourlyOrMore(expr), true, expr)
})

test('schedules with an hour or more between fires do not', () => {
  for (const expr of ['0 9 * * *', '0 */2 * * *', '5 1,3,5 * * *', '0 2 * * 1', 'not cron'])
    assert.equal(firesHourlyOrMore(expr), false, expr)
})
