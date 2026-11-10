import assert from 'node:assert/strict'
import { test } from 'node:test'

import { parseChoiceRequest, parseSecretRequest } from '../agent/panel/connectCardModel.ts'

import { botChatQuestion } from './botChatQuestion.ts'

import type { AgentInputRequest } from '../../api/agent-types.ts'

function request(fields: Partial<AgentInputRequest>): AgentInputRequest {
  return {
    id: 'req-1',
    category: 'approval',
    question: 'Ship the rollout?',
    askedAt: '2026-11-09T03:00:00Z',
    status: 'open',
    ...fields,
  } as AgentInputRequest
}

test('a choice is drawn as its own card and answers its request', () => {
  const question = botChatQuestion(request({ options: ['Ship it', 'Wait'] }))

  assert.equal(question.part.toolName, 'request_user_decision')
  assert.equal(question.part.toolCallId, 'req-1')
  assert.deepEqual(question.part.input, {
    question: 'Ship the rollout?',
    options: ['Ship it', 'Wait'],
  })
  assert.equal(question.answerable, true)
  // The card sends its own call id, which is the request's: the answer resolves that request.
  assert.equal(
    question.replyTo({ toolCallId: 'req-1', question: 'Ship the rollout?', options: ['Ship it'] }),
    'req-1',
  )
  assert.equal(question.replyTo(), 'req-1')
})

test('a secret is answered from its secure card', () => {
  const question = botChatQuestion(
    request({ category: 'credential', question: 'Paste the key', secretName: 'API_KEY' }),
  )

  assert.equal(question.answerable, true)
  assert.deepEqual(question.questions, [
    { id: 'req-1', question: 'Paste the key', secret: true, secretName: 'API_KEY' },
  ])
})

test('a secret record draws the masked secure card in a Bot chat and the Inbox', () => {
  const secret = request({
    category: 'credential',
    question: 'Paste the client secret',
    secretName: 'CLIENT_SECRET',
  })
  const { part } = botChatQuestion(secret)

  // The Inbox keys on the record itself and draws this same card.
  assert.notEqual(parseSecretRequest(secret), null)
  // The card's input is the secure card's, never a question card's.
  assert.deepEqual(parseSecretRequest(part.input), {
    name: 'CLIENT_SECRET',
    reason: 'Paste the client secret',
  })
  assert.equal(parseChoiceRequest(part.input), null)
})

test('a free-form question is shown but answered in its own conversation', () => {
  assert.equal(botChatQuestion(request({ category: 'preference' })).answerable, false)
  assert.equal(botChatQuestion(request({ options: [] })).answerable, false)
  // A credential without a secret name has no secure card to answer it with.
  assert.equal(botChatQuestion(request({ category: 'credential' })).answerable, false)
})

test('a connection is answered from its Connect card where the chat can select credentials', () => {
  const connect = request({
    category: 'integration',
    question: 'Connect Linear',
    providers: ['linear'],
  })
  const question = botChatQuestion(connect, true)

  assert.deepEqual(question.part.input, {
    category: 'integration',
    providers: ['linear'],
    question: 'Connect Linear',
  })
  assert.equal(question.answerable, true)
  // Without the asking conversation's picker, the card is only shown.
  assert.equal(botChatQuestion(connect).answerable, false)
})
