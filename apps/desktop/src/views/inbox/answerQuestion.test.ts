import assert from 'node:assert/strict'
import test from 'node:test'

import type { AgentConversation } from '../../api/agent-types.ts'

type Listener = (payload: { streamId: string; event: unknown }) => void
const listeners = new Set<Listener>()
const started: {
  streamId: string
  sessionId: string
  decisionReplyTo?: string
  messages: unknown[]
}[] = []
const posted: unknown[][] = []
let postFails = false

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
      agentPostChannelMessage: async (...args: unknown[]) => {
        posted.push(args)
        if (postFails) throw new Error('offline')

        return { id: args[3] }
      },
    },
  },
})

const inbox = await import('./useInbox.ts')
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
  inbox.publishInboxListing('team', [waiting('q-ok')])
  void inbox.answerQuestion('team', 'agent', 'q-ok', 'Ship it')

  assert.equal(inbox.inboxCountFor('team'), 0, 'gone before the turn starts')
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
  assert.equal(inbox.inboxCountFor('team'), 0, 'and stays gone once it started')
})

test('a send that fails brings the card back, with why', async () => {
  inbox.publishInboxListing('team', [waiting('q-fail')])
  void inbox.answerQuestion('team', 'agent', 'q-fail', 'Ship it')
  assert.equal(inbox.inboxCountFor('team'), 0)
  emit(started.at(-1)!.streamId, { type: 'error', error: 'This question was already answered' })
  await settle()
  assert.equal(inbox.inboxCountFor('team'), 1)
  // The failure clears once the question is answered again.
  void inbox.answerQuestion('team', 'agent', 'q-fail', 'Wait')
  assert.equal(inbox.inboxCountFor('team'), 0)
})

test("a Bot's own question is answered by a post in its chat", async () => {
  inbox.publishInboxListing('team', [waiting('q-chat')])
  const sent = inbox.answerInChat('team', 'chat', 'q-chat', 'Ship it', 'post-1')

  assert.equal(inbox.inboxCountFor('team'), 0, 'gone at once')
  assert.equal(await sent, true)
  assert.deepEqual(posted.at(-1), [
    'chat',
    'team',
    'Ship it',
    'post-1',
    undefined,
    undefined,
    undefined,
    'q-chat',
  ])
  assert.equal(inbox.inboxCountFor('team'), 0, 'and stays gone once posted')
})

test('a post that fails brings the card back', async () => {
  inbox.publishInboxListing('team', [waiting('q-chat-fail')])
  postFails = true
  assert.equal(await inbox.answerInChat('team', 'chat', 'q-chat-fail', 'Ship it'), false)
  postFails = false
  assert.equal(inbox.inboxCountFor('team'), 1)
})
