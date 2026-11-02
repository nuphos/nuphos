import assert from 'node:assert/strict'
import { test } from 'node:test'

import { updateProgress } from './updateProgress.ts'

test('a download reports percent, size and speed', () => {
  assert.deepEqual(
    updateProgress({ transferred: 48_300_000, total: 112_000_000, bytesPerSecond: 6_200_000 }),
    { percent: 43, done: '48.3 MB', total: '112 MB', speed: '6.2 MB' },
  )
})

test('an unknown size shows no progress yet', () => {
  assert.equal(updateProgress({ transferred: 0, total: 0, bytesPerSecond: 0 }), null)
})
