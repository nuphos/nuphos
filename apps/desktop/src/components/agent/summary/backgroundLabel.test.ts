import assert from 'node:assert/strict'
import { test } from 'node:test'

import { backgroundLabel } from './backgroundLabel.ts'

test('a dock terminal alone names the terminal, not a background task', () => {
  assert.equal(backgroundLabel(0, 1), '1 command running in a terminal')
  assert.equal(backgroundLabel(0, 2), '2 commands running in terminals')
})

test('runtime tasks alone keep their own label', () => {
  assert.equal(backgroundLabel(1, 0), '1 background task running')
  assert.equal(backgroundLabel(3, 0), '3 background tasks running')
})

test('both kinds are named side by side', () => {
  assert.equal(backgroundLabel(1, 2), '1 background task running · 2 commands running in terminals')
})
