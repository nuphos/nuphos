import assert from 'node:assert/strict'
import test from 'node:test'

import { registerTextDrainCompletion } from './streamBuffer.ts'

import type { TextStreamBuffer } from './streamBuffer.ts'

test('buffered text registers a single completion behind its drain', () => {
  let firstCalls = 0
  let secondCalls = 0
  const entry: TextStreamBuffer = { text: 'replayed response', timer: null }

  assert.equal(
    registerTextDrainCompletion(entry, () => {
      firstCalls++
    }),
    true,
  )
  assert.equal(
    registerTextDrainCompletion(entry, () => {
      secondCalls++
    }),
    true,
  )

  entry.onDrained?.()
  assert.equal(firstCalls, 1)
  assert.equal(secondCalls, 0)
})

test('an empty or absent buffer does not defer completion', () => {
  assert.equal(
    registerTextDrainCompletion(undefined, () => null),
    false,
  )
  assert.equal(
    registerTextDrainCompletion({ text: '', timer: null }, () => null),
    false,
  )
})
