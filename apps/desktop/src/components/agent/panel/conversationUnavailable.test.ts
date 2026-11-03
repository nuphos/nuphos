import assert from 'node:assert/strict'
import { test } from 'node:test'

import { openingAfterFailure } from './conversationUnavailable.ts'

const backendError = (code: string, message: string) =>
  new Error(`__ATLAS_API_ERROR__${JSON.stringify({ code, message })}`)

test('an unreadable chat stays open as unavailable, with no title', () => {
  assert.deepEqual(openingAfterFailure('s1', backendError('not_found', 'Conversation not found')), {
    sessionId: 's1',
    title: '',
    unavailable: true,
  })
})

test('any other failure clears the open', () => {
  assert.equal(openingAfterFailure('s1', new TypeError('fetch failed')), null)
  assert.equal(openingAfterFailure('s1', backendError('internal_error', 'Server error')), null)
})
