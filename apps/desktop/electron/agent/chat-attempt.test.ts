import assert from 'node:assert/strict'
import { test } from 'node:test'

import { effectiveFirstByteTimeout } from './chat-shared.ts'

test('first attempt uses the base 5s deadline', () => {
  assert.equal(effectiveFirstByteTimeout(0), 5_000)
})

test('deadline escalates by 3s per consecutive timeout', () => {
  assert.equal(effectiveFirstByteTimeout(1), 8_000)
  assert.equal(effectiveFirstByteTimeout(3), 14_000)
})

test('deadline caps at 30s', () => {
  assert.equal(effectiveFirstByteTimeout(9), 30_000)
  assert.equal(effectiveFirstByteTimeout(20), 30_000)
})
