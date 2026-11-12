import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  cardAnswerState,
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

test("a conversation's one open request is its one question", () => {
  assert.deepEqual(conversationQuestions({}), [])
  assert.deepEqual(
    conversationQuestions({
      inputRequests: [
        {
          id: 'q1',
          question: 'Red or blue?',
          options: ['red', 'blue'],
          category: 'preference',
          askedAt: '2026-10-28T00:00:00Z',
          status: 'open',
        },
      ],
    }),
    [older],
  )
})

test('a credential question is a secret, answered in its card', () => {
  const inputRequests = [
    {
      id: 'q9',
      question: 'Paste the deploy token',
      category: 'credential',
      askedAt: '2026-10-28T00:00:00Z',
      status: 'open' as const,
    },
  ]

  assert.deepEqual(conversationQuestions({ inputRequests }), [
    { id: 'q9', question: 'Paste the deploy token', secret: true },
  ])
  // Its secure card still answers exactly that request.
  assert.equal(
    cardReplyId(
      { toolCallId: 'exec-9', question: 'Paste the deploy token' },
      conversationQuestions({ inputRequests }),
    ),
    'q9',
  )
})

test('every open request of a conversation is a question, oldest first; settled ones are not', () => {
  const request = (id: string, askedAt: string, status: 'open' | 'answered') => ({
    id,
    category: 'preference',
    question: `${id}?`,
    askedAt,
    status,
  })

  assert.deepEqual(
    conversationQuestions({
      inputRequests: [
        request('late', '2026-10-28T02:00:00Z', 'open'),
        request('done', '2026-10-28T00:00:00Z', 'answered'),
        request('early', '2026-10-28T01:00:00Z', 'open'),
      ],
    }),
    [
      { id: 'early', question: 'early?' },
      { id: 'late', question: 'late?' },
    ],
  )
})

test('an open question stays answerable after later messages and during a turn', () => {
  const card = { toolCallId: 'call-1', question: 'API key for the fixture service' }
  const open = [{ id: 'call-1', question: card.question, secret: true as const }]
  const busy = { latestIdle: false, canReply: true }

  assert.equal(cardAnswerState(card, open, busy), 'open')
  assert.equal(cardAnswerState({ ...card, toolCallId: 'native-1' }, open, busy), 'open')
  assert.equal(cardAnswerState(card, [], busy), 'closed')
  assert.equal(cardAnswerState(card, undefined, busy), 'busy')
  assert.equal(cardAnswerState(card, undefined, { latestIdle: true, canReply: true }), 'open')
  assert.equal(cardAnswerState(card, open, { latestIdle: true, canReply: false }), 'offline')
})

test('a secret matches its request by id, else by secret name and text, and a tie matches none', () => {
  const reason = 'Paste the fixture key.'
  const login = { id: 'r1', question: reason, secret: true as const, secretName: 'FIXTURE_LOGIN' }
  const password = {
    id: 'r2',
    question: reason,
    secret: true as const,
    secretName: 'FIXTURE_PASSWORD',
  }
  const card = { toolCallId: 'native-9', question: reason, secretName: 'FIXTURE_PASSWORD' }

  // Two open requests share the reason: the name picks the right one.
  assert.equal(matchInputRequest(card, [login, password])?.id, 'r2')
  // The id the tool result names wins over text.
  assert.equal(matchInputRequest({ ...card, requestId: 'r1' }, [login, password])?.id, 'r1')
  // Answered already: the sibling with the same reason doesn't stand in for it.
  assert.equal(matchInputRequest(card, [login]), undefined)
  // Requests stored before names were kept: same text twice is a tie, so neither.
  const unnamed = [
    { id: 'r1', question: reason, secret: true as const },
    { id: 'r2', question: reason, secret: true as const },
  ]

  assert.equal(matchInputRequest(card, unnamed), undefined)
  assert.equal(matchInputRequest(card, unnamed.slice(0, 1))?.id, 'r1')
  // A tie leaves the card disabled instead of answering the wrong request.
  assert.equal(cardAnswerState(card, unnamed, { latestIdle: false, canReply: true }), 'closed')
})
