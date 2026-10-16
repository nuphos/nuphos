import assert from 'node:assert/strict'
import { test } from 'node:test'

import { firstMessageNewerThan } from './messagePlacement.ts'

test('the slot after the last message stamped at or before the time', () => {
  const messages = [{ createdAt: 1_000 }, { createdAt: 3_000 }, { createdAt: 5_000 }]

  assert.equal(firstMessageNewerThan(messages, 500), 0)
  assert.equal(firstMessageNewerThan(messages, 1_000), 1)
  assert.equal(firstMessageNewerThan(messages, 4_000), 2)
  assert.equal(firstMessageNewerThan(messages, 9_000), -1)
  assert.equal(firstMessageNewerThan([], 9_000), -1)
})

test('an unstamped message is newer than the stamped ones before it and older than the next', () => {
  const messages = [{ createdAt: 1_000 }, {}, { createdAt: 3_000 }, {}]

  // Between the first and the unstamped second: the second is the first newer.
  assert.equal(firstMessageNewerThan(messages, 2_000), 1)
  // After the third: only the unstamped tail is newer.
  assert.equal(firstMessageNewerThan(messages, 4_000), 3)
})
