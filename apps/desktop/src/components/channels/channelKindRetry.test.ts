import assert from 'node:assert/strict'
import { test } from 'node:test'

import { afterFailedCheck } from './channelKindRetry.ts'

const backendError = (code: string, message: string) =>
  new Error(`__ATLAS_API_ERROR__${JSON.stringify({ code, message })}`)

test('a session the reader cannot see gives up at once and settles now', () => {
  assert.deepEqual(afterFailedCheck(backendError('not_found', 'Conversation not found'), 0), {
    tries: 3,
    givenUp: true,
    delayMs: 0,
  })
})

test('a retryable failure is tried three times, three seconds apart', () => {
  const offline = new TypeError('fetch failed')

  assert.deepEqual(afterFailedCheck(offline, 0), { tries: 1, givenUp: false, delayMs: 3000 })
  assert.deepEqual(afterFailedCheck(offline, 1), { tries: 2, givenUp: false, delayMs: 3000 })
  assert.deepEqual(afterFailedCheck(offline, 2), { tries: 3, givenUp: true, delayMs: 3000 })
  assert.deepEqual(afterFailedCheck(backendError('internal_error', 'Boom'), 0), {
    tries: 1,
    givenUp: false,
    delayMs: 3000,
  })
})
