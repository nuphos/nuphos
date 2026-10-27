import assert from 'node:assert/strict'
import { before, beforeEach, mock, test } from 'node:test'

import type { StartChatArgs } from './chat-shared.ts'

let startChat: typeof import('./chat.ts').startChat
let response: () => Promise<Response>
const resolved: unknown[][] = []
let accountAbort = new AbortController()

before(async () => {
  mock.module('./http.ts', {
    namedExports: {
      agentAccount: async () => ({ signal: accountAbort.signal }),
      teamIdFromUrl: () => undefined,
    },
  })
  mock.module('./chat-attempt.ts', {
    namedExports: { postChatAttempt: () => response() },
  })
  mock.module('./client-tools.ts', { namedExports: { setSessionTeam: () => {} } })
  mock.module('./local-exec.ts', { namedExports: { logLocalTool: () => {} } })
  mock.module('./notify.ts', { namedExports: { broadcast: () => {} } })
  mock.module('./decisions.ts', {
    namedExports: {
      resolveDecision: async (...args: unknown[]) => {
        resolved.push(args)
      },
    },
  })
  ;({ startChat } = await import('./chat.ts'))
})

beforeEach(() => {
  resolved.length = 0
  accountAbort = new AbortController()
  response = async () =>
    new Response('data: {"type":"atlas-turn-complete"}\n\ndata: {"type":"atlas-stream-done"}\n\n', {
      headers: { 'content-type': 'text/event-stream' },
    })
})

const answer: StartChatArgs = {
  sessionId: 'session',
  streamId: 'reply-stream',
  teamId: 'team',
  messages: [],
  decisionReplyTo: 'question-1',
}

test('an IPC start alone leaves the question pending until the reply is delivered', async () => {
  const complete = response
  let deliver!: (response: Response) => void
  let entered!: () => void
  const started = new Promise<void>((resolve) => {
    entered = resolve
  })

  response = () =>
    new Promise((resolve) => {
      deliver = resolve
      entered()
    })
  const sending = startChat(answer)

  await started
  assert.deepEqual(resolved, [])
  deliver(await complete())
  await sending
  assert.deepEqual(resolved, [['session', 'question-1', 'team']])
})

test('a durably queued answer resolves its exact question', async () => {
  response = async () => new Response('{"mode":"queued"}', { status: 202 })

  await startChat(answer)
  assert.deepEqual(resolved, [['session', 'question-1', 'team']])
})

test('a rejected send leaves the question available to answer again', async () => {
  response = async () => new Response('{"error":{"message":"Denied"}}', { status: 403 })

  await startChat(answer)
  assert.deepEqual(resolved, [])
})

test('a failed agent stream leaves the question pending', async () => {
  response = async () =>
    new Response('data: {"type":"error","errorText":"Your refresh token was revoked."}\n\n')

  await startChat(answer)
  assert.deepEqual(resolved, [])
})

test('signing out during a send cannot resolve a question under a different account', async () => {
  const complete = response

  response = async () => {
    accountAbort.abort()

    return complete()
  }
  await startChat(answer)
  assert.deepEqual(resolved, [])
})

test('ordinary conversation messages do not resolve the pending question', async () => {
  await startChat({ ...answer, decisionReplyTo: undefined })
  assert.deepEqual(resolved, [])
})
