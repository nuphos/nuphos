import assert from 'node:assert/strict'
import { test } from 'node:test'

import { stillStuck } from './followBottom.ts'

test('content growing right after a follow does not let go of the bottom', () => {
  // The view was put at the bottom (top 1000); before that scroll is handled the
  // content grew by 220px, so the view now sits 220px above the new bottom.
  assert.equal(stillStuck(true, false, 1000, 1000), true)
  assert.equal(stillStuck(true, false, 1000, 800), true)
})

test('only the reader scrolling up, away from the bottom, lets go', () => {
  assert.equal(stillStuck(true, false, 600, 1000), false)
  // A small nudge up stays within the threshold and keeps following.
  assert.equal(stillStuck(true, true, 990, 1000), true)
})

test('coming back near the bottom follows again', () => {
  assert.equal(stillStuck(false, true, 1400, 600), true)
  assert.equal(stillStuck(false, false, 900, 600), false)
})
