import assert from 'node:assert/strict'
import { test } from 'node:test'

import { startsTimeGap, timeGapLabel } from './chatTime.ts'

const at = (day: number, hour: number, minute = 0) =>
  new Date(2026, 10, day, hour, minute).getTime()

test('a time shows above the first post, after 15 quiet minutes, and on a new day', () => {
  assert.equal(startsTimeGap(at(6, 13), undefined), true)
  assert.equal(startsTimeGap(at(6, 13, 15), at(6, 13)), false)
  assert.equal(startsTimeGap(at(6, 13, 16), at(6, 13)), true)
  assert.equal(startsTimeGap(at(7, 0, 1), at(6, 23, 59)), true)
  assert.equal(startsTimeGap(0, at(6, 13)), false)
})

test('the label reads like iMessage', () => {
  const now = at(6, 18)

  assert.match(timeGapLabel(at(6, 13, 5), now), /^Today /)
  assert.match(timeGapLabel(at(5, 9, 12), now), /^Yesterday /)
  assert.match(timeGapLabel(at(3, 9), now), /^Tuesday /)
  assert.match(timeGapLabel(at(20, 9, 0) - 30 * 86_400_000, now), /Oct/)
})
