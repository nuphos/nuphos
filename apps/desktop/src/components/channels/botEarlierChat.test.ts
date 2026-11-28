import assert from 'node:assert/strict'
import { test } from 'node:test'

import { hasEarlierBotChat } from './botEarlierChat.ts'

const chat = { createdAt: '2026-11-25T02:00:00.000Z' }

test('a Bot that talked before its chat was made leads back to that conversation', () => {
  assert.equal(
    hasEarlierBotChat({ messageCount: 12, lastActiveAt: '2026-11-17T08:00:00.000Z' }, chat),
    true,
  )
})

test('a Bot that only spoke once its chat existed has nothing earlier', () => {
  assert.equal(
    hasEarlierBotChat({ messageCount: 3, lastActiveAt: '2026-11-25T02:00:05.000Z' }, chat),
    false,
  )
})

test('a Bot without messages, or not yet listed, has nothing earlier', () => {
  assert.equal(
    hasEarlierBotChat({ messageCount: 0, lastActiveAt: '2026-11-17T08:00:00.000Z' }, chat),
    false,
  )
  assert.equal(hasEarlierBotChat(undefined, chat), false)
  assert.equal(
    hasEarlierBotChat({ messageCount: 4, lastActiveAt: '2026-11-17T08:00:00.000Z' }, null),
    false,
  )
})

test('an unreadable time shows no link rather than a wrong one', () => {
  assert.equal(hasEarlierBotChat({ messageCount: 4, lastActiveAt: '' }, chat), false)
  assert.equal(
    hasEarlierBotChat(
      { messageCount: 4, lastActiveAt: '2026-11-17T08:00:00.000Z' },
      { createdAt: '' },
    ),
    false,
  )
})
