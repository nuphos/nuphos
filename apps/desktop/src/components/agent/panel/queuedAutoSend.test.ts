import assert from 'node:assert/strict'
import test from 'node:test'

import {
  adoptSideStream,
  dispatchedDraft,
  rememberDispatchedDraft,
  rememberSideSend,
  runtimeMayAcceptLater,
  sendsAsNewSession,
  showQueued,
  showTurnQueued,
  takeSideSend,
  waitingMessages,
} from './queuedAutoSend.ts'

import type { Tab } from './model.ts'
import type { RuntimeExecution } from '../../../lib/runtimeExecution.ts'

const tab = (overrides: Partial<Tab> = {}): Tab =>
  ({
    id: 'tab-1',
    sessionId: 'session-1',
    title: 'Chat',
    messages: [],
    streaming: false,
    connected: true,
    streamId: null,
    ...overrides,
  }) as Tab

const status = (send: boolean): RuntimeExecution => ({
  schemaVersion: 2,
  state: 'idle',
  label: send ? 'Ready' : 'Reading session settings',
  actions: { send, cancel: false, steer: false },
  observedAt: performance.now(),
})

test('a turn the server queued leaves the transcript for the strip; the tab follows what runs', () => {
  rememberDispatchedDraft('stream-1', { id: 'msg-1', text: 'and the arrow keys', filePaths: [] })
  const sent = tab({
    streaming: true,
    streamId: 'stream-1',
    messages: [
      { id: 'earlier', role: 'assistant', parts: [] },
      { id: 'msg-1', role: 'user', parts: [{ type: 'text', text: 'and the arrow keys' }] },
    ],
  })
  const queued = showTurnQueued(sent, dispatchedDraft('stream-1'))

  assert.equal(queued.streaming, false)
  assert.equal(queued.streamId, null)
  assert.deepEqual(
    queued.messages.map((message) => message.id),
    ['earlier'],
  )
  assert.deepEqual(waitingMessages(queued), [
    { id: 'msg-1', text: 'and the arrow keys', filePaths: [] },
  ])
  // Its turn starting puts it in the transcript, and the strip lets it go.
  const started = {
    ...queued,
    messages: [...queued.messages, { id: 'msg-1', role: 'user' as const, parts: [] }],
  }

  assert.deepEqual(waitingMessages(started), [])
})

test('a send from a tab showing another turn waits without taking that turn', () => {
  const busy = tab({ streaming: true, streamId: 'thread-turn' })

  rememberSideSend('side-1', busy.id)
  rememberDispatchedDraft('side-1', { id: 'msg-2', text: 'next', filePaths: [] })
  const waiting = showQueued(busy, { id: 'msg-2', text: 'next', filePaths: [] })

  assert.equal(waiting.streamId, 'thread-turn')
  assert.deepEqual(
    waitingMessages(waiting).map((item) => item.id),
    ['msg-2'],
  )
  // The first event names the tab once; a turn that started at once is adopted.
  assert.equal(takeSideSend('side-1'), busy.id)
  assert.equal(takeSideSend('side-1'), undefined)
  const adopted = adoptSideStream(waiting, 'side-1', dispatchedDraft('side-1')?.id)

  assert.equal(adopted.streamId, 'side-1')
  assert.equal(adopted.streaming, true)
  assert.deepEqual(waitingMessages(adopted), [])
})

test('a refusal with nothing to show only clears the transport', () => {
  const cleared = showTurnQueued(tab({ streaming: true, streamId: 's' }), undefined)

  assert.equal(cleared.streaming, false)
  assert.equal(cleared.queued, undefined)
})

test('only an agent that can never accept a message is not waited on', () => {
  assert.equal(runtimeMayAcceptLater(status(false)), true)
  assert.equal(runtimeMayAcceptLater(undefined), true)
  assert.equal(
    runtimeMayAcceptLater({ state: 'disconnected', observedAt: performance.now() }),
    true,
  )
  assert.equal(runtimeMayAcceptLater({ state: 'idle', observedAt: performance.now() }), false)
})

test("a fork's first send goes straight out; a second one while it runs queues", () => {
  assert.equal(sendsAsNewSession({ unsaved: true, streaming: false }), true)
  assert.equal(sendsAsNewSession({ unsaved: true, streaming: true }), false)
  assert.equal(sendsAsNewSession({ unsaved: false, streaming: false }), false)
})
