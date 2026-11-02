import assert from 'node:assert/strict'
import { test } from 'node:test'

import { tabStep } from './homeGalleryKeys.ts'

test('tabStep moves along the tabs with either arrow axis and stops at the ends', () => {
  assert.equal(tabStep('ArrowDown', 0, 5), 1)
  assert.equal(tabStep('ArrowRight', 3, 5), 4)
  assert.equal(tabStep('ArrowRight', 4, 5), 4)
  assert.equal(tabStep('ArrowUp', 0, 5), 0)
  assert.equal(tabStep('ArrowLeft', 2, 5), 1)
  assert.equal(tabStep('Home', 3, 5), 0)
  assert.equal(tabStep('End', 0, 5), 4)
  assert.equal(tabStep('Enter', 2, 5), null)
})
