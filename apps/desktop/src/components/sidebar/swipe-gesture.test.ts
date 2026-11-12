import assert from 'node:assert/strict'
import { test } from 'node:test'

import { swipeDestination } from './swipe-gesture.ts'

test('small sideways jitter returns to the current page', () => {
  assert.equal(swipeDestination(0, -8, 248, 0.1), 0)
  assert.equal(swipeDestination(1, 8, 248, 0.1), 1)
})
test('an intentional short flick selects the adjacent page on release', () => {
  assert.equal(swipeDestination(0, -20, 248, -0.8), 1)
  assert.equal(swipeDestination(1, 20, 248, 0.8), 0)
})
test('slow swipes use distance and cannot pass the first or last page', () => {
  assert.equal(swipeDestination(0, -45, 248), 1)
  assert.equal(swipeDestination(1, 45, 248), 0)
  assert.equal(swipeDestination(0, 120, 248), 0)
  assert.equal(swipeDestination(1, -120, 248), 1)
})
