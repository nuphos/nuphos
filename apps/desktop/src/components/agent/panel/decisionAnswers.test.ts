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

test("a card shows the answer the server's notice records, by its request id", () => {
  const asked: Message = {
    ...card('call-1'),
    parts: [
      {
        type: 'tool',
        toolCallId: 'call-1',
        toolName: 'request_user_decision',
        state: 'output-available',
        input: { category: 'approval', question: 'Install Xcode?', options: OPTIONS },
        output: { requestId: 'nuphos-q1' },
      },
    ],
  }
  const notice = (requestId: string): Message => ({
    id: `n-${requestId}`,
    role: 'user',
    parts: [
      {
        type: 'text',
        text: [
          `Your question (requestId ${requestId}) was answered from the Inbox.`,
          'Answered by: "Sam", this conversation\'s owner: it is their own answer.',
          'Question: Install Xcode?',
          'Context you gave: - a list → in the body',
          'Answer:',
          '- Install Xcode? → Started the download',
          'Continue the task with this answer.',
        ].join('\n'),
      },
    ],
    metadata: {
      version: 1,
      sender: { type: 'system', id: 'nuphos:decision', displayName: 'Nuphos' },
      source: 'agent.resource',
      sentAt: '2026-11-12T06:00:00Z',
    },
  })

  assert.deepEqual(decisionAnswers([asked, notice('nuphos-q1')]).get('call-1'), {
    option: 'Started the download',
  })
  // Another request's notice answers nothing here.
  assert.equal(decisionAnswers([asked, notice('nuphos-q9')]).size, 0)
})

test('a choice card is answered through the server, never by a reply in the transcript', () => {
  // Choosing sends no message; a reply naming an option answers nothing here.
  assert.equal(decisionAnswers([card('q1'), reply('Started the download', SAM)]).size, 0)
})

const secret = (id: string, name: string): Message => ({
  id: `m-${id}`,
  role: 'assistant',
  parts: [
    {
      type: 'tool',
      toolCallId: id,
      toolName: 'request_user_decision',
      state: 'output-available',
      input: { category: 'credential', question: 'Paste the key', secretName: name },
    },
  ],
})

test('a secret card is answered by its saved reply, never by other text or another name', () => {
  const answers = decisionAnswers([
    secret('s1', 'OPENAI_API_KEY'),
    secret('s2', 'GITHUB_TOKEN'),
    reply('here it is'),
    reply('🔒 OPENAI_API_KEY saved to /home/agent/.nuphos/secrets/OPENAI_API_KEY'),
  ])

  assert.equal(
    answers.get('s1')?.option,
    '🔒 OPENAI_API_KEY saved to /home/agent/.nuphos/secrets/OPENAI_API_KEY',
  )
  assert.equal(answers.has('s2'), false)
})
