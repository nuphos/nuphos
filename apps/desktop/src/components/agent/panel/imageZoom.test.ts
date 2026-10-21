import assert from 'node:assert/strict'
import { test } from 'node:test'

import { imageFitScale, imageZoomScale, zoomScrollOffset } from './imageZoom.ts'

test('a tall screenshot fits on open and can grow to readable actual size', () => {
  const fit = imageFitScale(1440, 12000, 1200, 800)

  assert.equal(fit, 800 / 12000)
  assert.equal(imageZoomScale(1, fit), 1)
  assert.equal(imageZoomScale(0.001, fit), fit)
  assert.equal(imageZoomScale(100, fit), 8)
})

test('zoom preserves the point under the cursor across centered and scrollable images', () => {
  assert.equal(zoomScrollOffset(100, 1000, 500, 0, 250), 250)
  assert.equal(zoomScrollOffset(1000, 2000, 500, 400, 100), 900)
  assert.equal(zoomScrollOffset(2000, 100, 500, 900, 100), 0)
  assert.equal(zoomScrollOffset(100, 1000, 500, 0, 0), 0)
  assert.equal(zoomScrollOffset(2000, 1000, 500, 1500, 250), 500)
})
