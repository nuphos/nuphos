import assert from 'node:assert/strict'
import { test } from 'node:test'

import { overlayReach } from './composerOverlay.ts'

test('the chat makes room for the tallest bar above the composer, and none without one', () => {
  // A status banner 32px tall and a reply bar 60px tall, both resting on the composer at 700.
  assert.equal(overlayReach(700, [668, 640]), 60)
  assert.equal(overlayReach(700, [667.4]), 33)
  assert.equal(overlayReach(700, []), 0)
  // A bar still sliding in from below reaches no higher than the composer.
  assert.equal(overlayReach(700, [712]), 0)
})
