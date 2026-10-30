import assert from 'node:assert/strict'
import { test } from 'node:test'

import { playFitScale } from './playFit.ts'

const phone = { width: 390, height: 844 }

test('a screen that fits keeps its real size', () => {
  assert.equal(playFitScale(phone, { width: 1200, height: 900 }), 1)
})

test('a screen taller than the space shrinks to its height', () => {
  assert.equal(playFitScale(phone, { width: 1200, height: 422 }), 0.5)
})

test('a screen wider than the space shrinks to its width', () => {
  assert.equal(playFitScale({ width: 1440, height: 900 }, { width: 720, height: 900 }), 0.5)
})

test('an unmeasured space shows the real size', () => {
  assert.equal(playFitScale(phone, { width: 0, height: 0 }), 1)
})
