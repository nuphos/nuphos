import assert from 'node:assert/strict'
import { test } from 'node:test'

import { statFontSize } from './statFontSize.ts'

test('statFontSize fits the text to the narrower of width and height', () => {
  assert.equal(statFontSize('5.77%', 180, 300), 52)
  assert.equal(statFontSize('80.78', 180, 60), 36)
  assert.equal(statFontSize('0', 400, 400), 56)
})

test('statFontSize never drops below the floor or above the cap', () => {
  assert.equal(statFontSize('123456789', 40, 40), 14)
  assert.equal(statFontSize('0', 2000, 2000), 56)
  assert.equal(statFontSize('0', 0, 0), 14)
})
