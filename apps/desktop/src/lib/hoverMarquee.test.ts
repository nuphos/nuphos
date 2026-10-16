import assert from 'node:assert/strict'
import { test } from 'node:test'

import { hoverMarqueeDurationMs } from './hoverMarquee.ts'

test('hover marquee duration scales with the clipped distance', () => {
  assert.equal(hoverMarqueeDurationMs(120), 3000)
  assert.equal(hoverMarqueeDurationMs(240), 6000)
})

test('hover marquee duration is clamped for tiny and huge overflows', () => {
  assert.equal(hoverMarqueeDurationMs(4), 500)
  assert.equal(hoverMarqueeDurationMs(10_000), 8000)
})
