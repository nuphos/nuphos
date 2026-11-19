import assert from 'node:assert/strict'
import { test } from 'node:test'

import { nextReplyInbox } from './replyInbox.ts'

const set = (...ids: string[]) => new Set(ids)

test('opening a read old conversation never promotes it', () => {
  assert.deepEqual(nextReplyInbox(set(), set(), set(), 'old'), set())
})
test('a completed focused turn stays pending across read updates', () => {
  const pending = nextReplyInbox(set(), set('current'), set(), 'current')

  assert.deepEqual(pending, set('current'))
  assert.deepEqual(nextReplyInbox(pending, set(), set(), 'current'), pending)
})
test('leaving or starting another turn clears the temporary inbox entry', () => {
  assert.deepEqual(nextReplyInbox(set('current'), set(), set(), 'old'), set())
  assert.deepEqual(nextReplyInbox(set('current'), set(), set('current'), 'current'), set())
  assert.deepEqual(nextReplyInbox(set(), set(), set(), 'current'), set())
})

test('opening an unread result retains it until leaving, without promoting read history', () => {
  const pending = nextReplyInbox(set(), set(), set(), 'reply', set('reply'))

  assert.deepEqual(pending, set('reply'))
  assert.deepEqual(nextReplyInbox(pending, set(), set(), 'reply'), pending)
  assert.deepEqual(nextReplyInbox(pending, set(), set(), 'old'), set())
})
