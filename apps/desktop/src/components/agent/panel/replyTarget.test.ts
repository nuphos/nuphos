import assert from 'node:assert/strict'
import { test } from 'node:test'

import { cardReplyId, replyChoice } from './replyTarget.ts'

const older = { id: 'q1', question: 'Red or blue?' }
const newer = { id: 'q2', question: 'Cat or dog?' }

test('the chip defaults to the newest open question', () => {
  assert.equal(replyChoice('s', [], null), null)
  assert.equal(replyChoice('s', [older, newer], null), 'q2')
})

test('a picked older question stays chosen until it closes', () => {
  const pick = { sessionId: 's', id: 'q1', seen: ['q1', 'q2'] }

  assert.equal(replyChoice('s', [older, newer], pick), 'q1')
  assert.equal(replyChoice('s', [newer], pick), 'q2')
  assert.equal(replyChoice('other', [older, newer], pick), 'q2')
})

test('clearing sends ordinary messages until a new question arrives', () => {
  const cleared = { sessionId: 's', id: null, seen: ['q1', 'q2'] }

  assert.equal(replyChoice('s', [older, newer], cleared), null)
  assert.equal(replyChoice('s', [older], cleared), null)
  assert.equal(replyChoice('s', [older, newer, { id: 'q3', question: 'Tea?' }], cleared), 'q3')
})

test('a choice card answers its own question, matched by question when ids differ', () => {
  assert.equal(cardReplyId('q1', 'Red or blue?', [older, newer]), 'q1')
  assert.equal(cardReplyId('exec-1', 'Red or blue?', [older, newer]), 'q1')
  assert.equal(cardReplyId('exec-1', 'Unknown?', [older, newer]), 'exec-1')
  assert.equal(cardReplyId('exec-1', undefined, [older]), 'exec-1')
  assert.equal(cardReplyId('exec-1', 'Red or blue?', undefined), 'exec-1')
})
