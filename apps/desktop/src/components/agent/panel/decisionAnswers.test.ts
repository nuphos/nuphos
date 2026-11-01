import assert from 'node:assert/strict'
import test from 'node:test'

import { decisionAnswers } from './decisionAnswers.ts'

import type { Message } from './model'

const OPTIONS = ['Started the download', 'Done, Xcode is installed']

const card = (id: string, options = OPTIONS): Message => ({
  id: `m-${id}`,
  role: 'assistant',
  parts: [
    {
      type: 'tool',
      toolCallId: id,
      toolName: 'request_user_decision',
      state: 'output-available',
      input: { category: 'approval', question: 'Install Xcode?', options },
    },
  ],
})

const reply = (text: string, sender?: { id: string; displayName: string }): Message => ({
  id: `r-${text}-${sender?.id ?? 'local'}`,
  role: 'user',
  parts: [{ type: 'text', text }],
  ...(sender && {
    metadata: {
      version: 1,
      sender: { type: 'user', ...sender },
      source: 'nuphos',
      sentAt: '2026-10-30T06:00:00Z',
    },
  }),
})

const SAM = { id: 'u-sam', displayName: 'Sam Rivera' }

test('the reply after a card is its answer, with who sent it and when', () => {
  const answers = decisionAnswers([card('q1'), reply('Started the download', SAM)])

  assert.deepEqual(answers.get('q1'), {
    option: 'Started the download',
    sender: SAM,
    at: Date.parse('2026-10-30T06:00:00Z'),
  })
})

test('a reply not yet attributed is still the answer, sent from this device', () => {
  const answers = decisionAnswers([
    card('q1'),
    { ...reply('Done, Xcode is installed'), createdAt: 5 },
  ])

  assert.deepEqual(answers.get('q1'), { option: 'Done, Xcode is installed', at: 5 })
})

test('an open card has no answer, nor one answered in other words', () => {
  assert.equal(decisionAnswers([card('q1')]).size, 0)
  assert.equal(decisionAnswers([card('q1'), reply('I will do it tomorrow', SAM)]).size, 0)
})

test('a reply before the card does not answer it', () => {
  assert.equal(decisionAnswers([reply('Started the download', SAM), card('q1')]).size, 0)
})

test('the newest open card offering the reply takes it, and each card one answer', () => {
  const answers = decisionAnswers([
    card('q1'),
    card('q2'),
    reply('Started the download', SAM),
    reply('Started the download'),
  ])

  assert.equal(answers.get('q2')?.sender?.id, 'u-sam')
  assert.equal(answers.get('q1')?.sender, undefined)
})

test('connect and secure-input cards are not choices', () => {
  const connect: Message = {
    ...card('q1'),
    parts: [
      {
        type: 'tool',
        toolCallId: 'q1',
        toolName: 'request_user_decision',
        state: 'output-available',
        input: { category: 'integration', question: 'Connect?', providers: ['github'] },
      },
    ],
  }

  assert.equal(decisionAnswers([connect, reply('github', SAM)]).size, 0)
})
