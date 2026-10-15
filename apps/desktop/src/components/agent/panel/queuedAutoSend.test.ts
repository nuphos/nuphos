import assert from 'node:assert/strict'
import test from 'node:test'

import {
  dispatchedDraft,
  markAutoSend,
  nextAutoSend,
  parkRefusedTurn,
  parkFailedForkImport,
  pumpAutoSend,
  queueAutoSend,
  rememberDispatchedDraft,
  runtimeMayAcceptLater,
  sendsAsNewSession,
  stopAutoSend,
} from './queuedAutoSend.ts'

import type { QueuedMessage, Tab } from './model.ts'
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

test('a refused turn leaves the transcript and waits at the front of the queue', () => {
  rememberDispatchedDraft('stream-1', {
    id: 'msg-1',
    text: 'Approved plan #575 — please proceed with plan #575.',
    filePaths: [],
    turnKind: 'plan-approval',
  })
  const refused = tab({
    streaming: true,
    streamId: 'stream-1',
    messages: [
      { id: 'earlier', role: 'assistant', parts: [] },
      { id: 'msg-1', role: 'user', parts: [{ type: 'text', text: 'Approved plan #575' }] },
    ],
    queued: [{ id: 'later', text: 'and also this', filePaths: [] }],
  })

  const parked = parkRefusedTurn(refused, dispatchedDraft('stream-1'))

  assert.equal(parked.streaming, false)
  assert.equal(parked.streamId, null)
  assert.equal(parked.error, null)
  assert.deepEqual(
    parked.messages.map((message) => message.id),
    ['earlier'],
  )
  assert.deepEqual(parked.queued?.[0], {
    id: 'msg-1',
    text: 'Approved plan #575 — please proceed with plan #575.',
    filePaths: [],
    turnKind: 'plan-approval',
    autoSend: true,
  })
  assert.equal(parked.queued?.[1]?.id, 'later')
  assert.equal(parkRefusedTurn(parked, dispatchedDraft('stream-1')).queued?.length, 2)
})

test('a refusal with nothing to resend only clears the transport', () => {
  const parked = parkRefusedTurn(tab({ streaming: true, streamId: 's' }), undefined)

  assert.equal(parked.streaming, false)
  assert.equal(parked.queued, undefined)
})

test('a draft the user sends, or a steer the turn outran, waits in place for the next turn', () => {
  const waiting = tab({
    queued: [
      { id: 'first', text: 'first', filePaths: [], autoSend: true },
      { id: 'late', text: 'late', filePaths: [], steering: true },
      { id: 'draft', text: 'draft', filePaths: [] },
    ],
  })

  assert.deepEqual(markAutoSend(waiting, 'late').queued, [
    { id: 'first', text: 'first', filePaths: [], autoSend: true },
    { id: 'late', text: 'late', filePaths: [], steering: false, autoSend: true },
    { id: 'draft', text: 'draft', filePaths: [] },
  ])
  assert.equal(nextAutoSend(markAutoSend(waiting, 'draft'))?.id, 'first')
})

test('a queued message is sent only once a fresh status allows send', async () => {
  const waiting = queueAutoSend(tab(), {
    id: 'q-1',
    text: 'hello',
    filePaths: [],
    turnKind: 'plan-approval',
  })
  const probes = [status(false), status(false), status(true)]
  const dispatched: QueuedMessage[] = []
  const seen: RuntimeExecution[] = []
  const deps = {
    probe: () => Promise.resolve(probes.shift() ?? status(false)),
    onRuntimeState: (_tabId: string, snapshot: RuntimeExecution) => {
      seen.push(snapshot)
    },
    dispatch: (_tabId: string, item: QueuedMessage) => {
      dispatched.push(item)
    },
    onNeverSendable: () => assert.fail('the runtime can still accept later'),
  }

  assert.equal(await pumpAutoSend(waiting, deps), 'waiting')
  assert.equal(await pumpAutoSend(waiting, deps), 'waiting')
  assert.equal(dispatched.length, 0)
  assert.equal(await pumpAutoSend(waiting, deps), 'sent')
  assert.equal(dispatched[0]?.text, 'hello')
  assert.equal(dispatched[0]?.turnKind, 'plan-approval')
  assert.equal(seen.length, 3)
})

test('a streaming tab or a tab with only plain drafts is not probed', async () => {
  let probed = 0
  const deps = {
    probe: () => {
      probed += 1

      return Promise.resolve(status(true))
    },
    onRuntimeState: () => {},
    dispatch: () => {},
    onNeverSendable: () => {},
  }
  const drafts = tab({ queued: [{ id: 'd', text: 'draft', filePaths: [] }] })
  const streaming = queueAutoSend(tab({ streaming: true }), { id: 'q', text: 'x', filePaths: [] })

  assert.equal(nextAutoSend(drafts), undefined)
  assert.equal(await pumpAutoSend(drafts, deps), 'idle')
  assert.equal(await pumpAutoSend(streaming, deps), 'waiting')
  assert.equal(probed, 0)
})

test('a message queued on a fork whose import failed sends without probing', async () => {
  // The import failed, so the fork is still unsaved and its session answers 404.
  const fork = queueAutoSend(tab({ unsaved: true }), { id: 'q', text: 'retry', filePaths: [] })
  const dispatched: QueuedMessage[] = []
  const deps = {
    probe: () => Promise.reject(new Error('404 conversation not found')),
    onRuntimeState: () => assert.fail('nothing to probe'),
    dispatch: (_tabId: string, item: QueuedMessage) => {
      dispatched.push(item)
    },
    onNeverSendable: () => assert.fail('nothing to probe'),
  }

  assert.equal(await pumpAutoSend(fork, deps), 'sent')
  assert.equal(dispatched[0]?.text, 'retry')
})

test('a queued message stops waiting once a probe shows the agent can never accept it', async () => {
  const waiting = queueAutoSend(tab(), { id: 'q', text: 'hello', filePaths: [] })
  const outdated: RuntimeExecution = { state: 'idle', observedAt: performance.now() }
  const unsendable: string[] = []
  const result = await pumpAutoSend(waiting, {
    probe: () => Promise.resolve(outdated),
    onRuntimeState: () => {},
    dispatch: () => assert.fail('must not dispatch'),
    onNeverSendable: (tabId) => {
      unsendable.push(tabId)
    },
  })

  assert.equal(result, 'unsendable')
  assert.deepEqual(unsendable, ['tab-1'])
  const stopped = stopAutoSend(waiting)

  assert.equal(nextAutoSend(stopped), undefined)
  assert.equal(stopped.queued?.[0]?.text, 'hello')
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
  // The first send is importing and starting: a second Enter must not start another.
  assert.equal(sendsAsNewSession({ unsaved: true, streaming: true }), false)
  assert.equal(sendsAsNewSession({ unsaved: false, streaming: false }), false)
})

test('a fork whose import failed keeps its message first and sends nothing on its own', async () => {
  const first = { id: 'first', text: 'first prompt', filePaths: [] }
  // The first message started the import; a follow-up queued while it ran.
  const running = queueAutoSend(
    tab({
      unsaved: true,
      streaming: true,
      messages: [{ id: 'first', role: 'user', parts: [{ type: 'text', text: 'first prompt' }] }],
    } as Partial<Tab>),
    { id: 'second', text: 'follow-up', filePaths: [] },
  )
  const parked = parkFailedForkImport(running, first, 'Import failed')

  assert.deepEqual(parked.messages, [])
  assert.deepEqual(
    parked.queued?.map((item) => [item.id, item.autoSend]),
    [
      ['first', false],
      ['second', false],
    ],
  )
  assert.equal(parked.error, 'Import failed')
  assert.equal(parked.streaming, false)
  assert.equal(
    await pumpAutoSend(parked, {
      probe: () => assert.fail('nothing to send'),
      onRuntimeState: () => {},
      dispatch: () => assert.fail('the follow-up must not overtake the failed message'),
      onNeverSendable: () => {},
    }),
    'idle',
  )
})
