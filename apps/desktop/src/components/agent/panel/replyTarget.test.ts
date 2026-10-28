import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  cardReplyId,
  conversationQuestions,
  matchInputRequest,
  replyChoice,
} from './replyTarget.ts'

const older = { id: 'q1', question: 'Red or blue?', options: ['red', 'blue'] }
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
  const cleared = ['q1', 'q2']

  assert.equal(replyChoice('s', [older, newer], null, cleared), null)
  assert.equal(replyChoice('s', [older], null, cleared), null)
  assert.equal(
    replyChoice('s', [older, newer, { id: 'q3', question: 'Tea?' }], null, cleared),
    'q3',
  )
  // A pick made before clearing does not outlive the clear's question set.
  const pick = { sessionId: 's', id: 'q1', seen: ['q1'] }

  assert.equal(replyChoice('s', [older, newer], pick, cleared), null)
})

test('a card with the request id answers that request', () => {
  assert.equal(cardReplyId({ toolCallId: 'q2', question: 'Red or blue?' }, [older, newer]), 'q2')
})

test("a native runtime's exec- card is matched by its question and options", () => {
  const card = { toolCallId: 'exec-1', question: 'Red or blue?', options: ['red', 'blue'] }

  assert.equal(cardReplyId(card, [newer, older]), 'q1')
  assert.equal(matchInputRequest({ ...card, options: ['green'] }, [older]), undefined)
  // Options are compared only when both sides have them.
  assert.equal(
    cardReplyId({ toolCallId: 'exec-2', question: 'Cat or dog?', options: ['cat'] }, [newer]),
    'q2',
  )
})

test('the oldest request wins when two ask the same question', () => {
  const again = { id: 'q3', question: 'Red or blue?', options: ['red', 'blue'] }

  assert.equal(
    cardReplyId({ toolCallId: 'exec-1', question: 'Red or blue?' }, [older, again]),
    'q1',
  )
})

test('a card that matches nothing answers its own call id', () => {
  assert.equal(
    cardReplyId({ toolCallId: 'exec-1', question: 'Unknown?' }, [older, newer]),
    'exec-1',
  )
  assert.equal(cardReplyId({ toolCallId: 'exec-1' }, [older]), 'exec-1')
  assert.equal(cardReplyId({ toolCallId: 'exec-1', question: 'Red or blue?' }, undefined), 'exec-1')
})

test("a conversation's single pending decision is its one open question", () => {
  assert.deepEqual(conversationQuestions({}), [])
  assert.deepEqual(
    conversationQuestions({
      pendingDecision: {
        toolCallId: 'q1',
        question: 'Red or blue?',
        options: ['red', 'blue'],
        category: 'preference',
        askedAt: '2026-10-28T00:00:00Z',
      },
    }),
    [older],
  )
})
