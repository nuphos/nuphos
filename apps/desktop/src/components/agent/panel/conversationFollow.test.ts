import assert from 'node:assert/strict'
import { test } from 'node:test'

import { followNewContent, isOwnMessage, unseenMessageCount } from './conversationFollow.ts'

import type { Message } from './model.ts'

const sentBy = (id: string, senderId?: string, role: Message['role'] = 'user'): Message => ({
  id,
  role,
  parts: [{ type: 'text', text: id }],
  ...(senderId
    ? {
        metadata: {
          version: 1,
          sender: { type: 'user', id: senderId, displayName: senderId },
          source: 'nuphos',
        },
      }
    : {}),
})

test('a reader at the bottom follows new content', () => {
  const at = { ownSend: false, lockedToHistory: false }

  assert.equal(followNewContent({ ...at, following: true, nearBottom: true }), 'follow')
  assert.equal(followNewContent({ ...at, following: false, nearBottom: true }), 'follow')
})

test('a reader scrolled up stays put when a teammate posts or the agent streams', () => {
  assert.equal(
    followNewContent({
      ownSend: false,
      lockedToHistory: true,
      following: false,
      nearBottom: false,
    }),
    'stay',
  )
  assert.equal(
    followNewContent({
      ownSend: false,
      lockedToHistory: false,
      following: false,
      nearBottom: false,
    }),
    'stay',
  )
  // Scrolled up by a gesture, but only just: still reading history.
  assert.equal(
    followNewContent({ ownSend: false, lockedToHistory: true, following: false, nearBottom: true }),
    'stay',
  )
})

test('your own send takes you to the bottom even from history', () => {
  assert.equal(
    followNewContent({ ownSend: true, lockedToHistory: true, following: false, nearBottom: false }),
    'follow',
  )
})

test('only your own user message counts as your send', () => {
  assert.equal(isOwnMessage(sentBy('m', 'me'), 'me', false), true)
  assert.equal(isOwnMessage(sentBy('m', 'teammate'), 'me', false), false)
  assert.equal(isOwnMessage(sentBy('m', 'me', 'assistant'), 'me', false), false)
  // Unattributed messages predate attribution: the owner's, unless the chat is foreign.
  assert.equal(isOwnMessage(sentBy('m'), 'me', false), true)
  assert.equal(isOwnMessage(sentBy('m'), 'me', true), false)
})

test('the jump button counts shown messages after the last one read', () => {
  const messages = [sentBy('a', 'me'), sentBy('b', 'teammate'), sentBy('c', 'x', 'assistant')]

  assert.equal(unseenMessageCount(messages, 'a'), 2)
  assert.equal(unseenMessageCount(messages, 'c'), 0)
  assert.equal(unseenMessageCount(messages, null), 0)
  assert.equal(unseenMessageCount(messages, 'gone'), 0)
  // An earlier page loading above adds nothing unseen.
  assert.equal(unseenMessageCount([sentBy('old', 'me'), ...messages], 'a'), 2)
})
