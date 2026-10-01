import assert from 'node:assert/strict'
import { test } from 'node:test'

import { createUpdaterEventDedupe } from './updater-event-dedupe.ts'

// electron-updater re-emits update-available / update-downloaded on every
// 5-minute poll while an update sits pending (open app, not yet restarted).
// Analytics wants one event per discovered version, not one per poll — at the
// old rate that was ~890 events per user per month of pure noise (NUPS-646).

test('first sighting of a version captures, repeats do not', () => {
  const shouldCapture = createUpdaterEventDedupe()

  assert.equal(shouldCapture('update_available', '1.2.3'), true)
  assert.equal(shouldCapture('update_available', '1.2.3'), false)
  assert.equal(shouldCapture('update_available', '1.2.3'), false)
})

test('events dedupe independently for the same version', () => {
  const shouldCapture = createUpdaterEventDedupe()

  assert.equal(shouldCapture('update_available', '1.2.3'), true)
  assert.equal(shouldCapture('update_downloaded', '1.2.3'), true)
  assert.equal(shouldCapture('update_downloaded', '1.2.3'), false)
})

test('a newer version published mid-session captures again', () => {
  const shouldCapture = createUpdaterEventDedupe()

  assert.equal(shouldCapture('update_available', '1.2.3'), true)
  assert.equal(shouldCapture('update_available', '1.2.4'), true)
  assert.equal(shouldCapture('update_available', '1.2.3'), false)
})
