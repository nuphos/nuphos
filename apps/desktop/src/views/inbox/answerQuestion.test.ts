import assert from 'node:assert/strict'
import test from 'node:test'

import { inboxCount } from './inboxItems.ts'

import type { AgentConversation } from '../../api/agent-types.ts'

type Listener = (payload: { streamId: string; event: unknown }) => void
const listeners = new Set<Listener>()
const started: {
  streamId: string
  sessionId: string
  decisionReplyTo?: string
  messages: unknown[]
}[] = []
const answers: unknown[][] = []
let answerFails = false

Object.defineProperty(globalThis, 'window', {
  configurable: true,
  value: {
    addEventListener: () => {},
    removeEventListener: () => {},
    api: {
      onAgentEvent: (listener: Listener) => {
        listeners.add(listener)

        return () => listeners.delete(listener)
      },
      agentStart: async (args: (typeof started)[number]) => {
        started.push(args)
      },
      agentAnswerDecision: async (...args: unknown[]) => {
        answers.push(args)
        if (answerFails) throw new Error('This question is no longer open')

        return { ok: true }
      },
    },
  },
})

const inbox = await import('./useInbox.ts')
// The listing the badge last read, and the count it shows with this device's answers.
let listing: AgentConversation[] = []
const publish = (conversations: AgentConversation[]) => {
  listing = conversations
  inbox.settleAnswers(conversations)
}
const count = () => inboxCount(listing, inbox.answeredOnDevice())
const settle = () => new Promise((resolve) => setImmediate(resolve))
const emit = (streamId: string, event: unknown) => {
  for (const listener of [...listeners]) listener({ streamId, event })
}
const waiting = (id: string) =>
  ({
    sessionId: 'agent',
    isOwner: true,
    inputRequests: [{ id, category: 'preference', question: '?', askedAt: '', status: 'open' }],
  }) as AgentConversation

test('a choice is sent as the viewer message and its card leaves at once', async () => {
  publish([waiting('q-ok')])
  void inbox.answerQuestion('team', 'agent', 'q-ok', 'Ship it')

  assert.equal(count(), 0, 'gone before the turn starts')
  assert.deepEqual(started.at(-1)?.messages, [
    {
      id: (started.at(-1)?.messages[0] as { id: string }).id,
      role: 'user',
      parts: [{ type: 'text', text: 'Ship it' }],
    },
  ])
  assert.equal(started.at(-1)?.decisionReplyTo, 'q-ok')
  emit(started.at(-1)!.streamId, { type: 'start' })
  await settle()
  assert.equal(count(), 0, 'and stays gone once it started')
})

test('a send that fails brings the card back, with why', async () => {
  publish([waiting('q-fail')])
  void inbox.answerQuestion('team', 'agent', 'q-fail', 'Ship it')
  assert.equal(count(), 0)
  emit(started.at(-1)!.streamId, { type: 'error', error: 'This question was already answered' })
  await settle()
  assert.equal(count(), 1)
  // The failure clears once the question is answered again.
  void inbox.answerQuestion('team', 'agent', 'q-fail', 'Wait')
  assert.equal(count(), 0)
})

test('an answer goes to the server, which wakes the agent; the card leaves at once', async () => {
  publish([waiting('q-answer')])
  const messagesBefore = started.length
  const sent = inbox.answerDecision('team', 'agent', 'q-answer', { choices: ['Ship it'] })

  assert.equal(count(), 0, 'gone at once')
  await sent
  assert.deepEqual(answers.at(-1), ['agent', 'q-answer', 'team', { choices: ['Ship it'] }])
  assert.equal(started.length, messagesBefore, 'no message is sent')
  assert.equal(count(), 0, 'and stays gone once answered')
})

test('an answer the server refuses brings the card back', async () => {
  publish([waiting('q-refused')])
  answerFails = true
  await inbox.answerDecision('team', 'agent', 'q-refused', { text: 'Ship it' })
  answerFails = false
  assert.equal(count(), 1)
})
