import assert from 'node:assert/strict'
import test from 'node:test'

import { adjustCrop, centeredCrop, cropSourceRect, MAX_ZOOM } from './avatarCrop.ts'

const landscape = { width: 800, height: 400 }

test('a new crop centres the short side across the viewport', () => {
  const crop = centeredCrop(landscape.width, landscape.height, 200)

  assert.deepEqual(crop, { zoom: 1, x: -100, y: 0 })
  assert.deepEqual(cropSourceRect(crop, landscape, 200), { sx: 200, sy: 0, side: 400 })
})

test('panning stops at the image edges', () => {
  const crop = centeredCrop(landscape.width, landscape.height, 200)

  assert.deepEqual(adjustCrop(crop, landscape, 200, { dx: 500, dy: 50 }), { zoom: 1, x: 0, y: 0 })
  assert.deepEqual(adjustCrop(crop, landscape, 200, { dx: -500 }), { zoom: 1, x: -200, y: 0 })
})

test('zoom keeps the centre point and stays within bounds', () => {
  const crop = centeredCrop(landscape.width, landscape.height, 200)
  const zoomed = adjustCrop(crop, landscape, 200, { zoom: 2 })
  const rect = cropSourceRect(zoomed, landscape, 200)

  assert.deepEqual(rect, { sx: 300, sy: 100, side: 200 })
  assert.equal(adjustCrop(crop, landscape, 200, { zoom: 99 }).zoom, MAX_ZOOM)
  assert.deepEqual(adjustCrop(zoomed, landscape, 200, { zoom: 0 }), crop)
})
