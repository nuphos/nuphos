import assert from 'node:assert/strict'
import test from 'node:test'

import { threadState, threadsUnder } from './threadLifecycle.ts'

import type { RuntimeExecution } from './runtimeExecution.ts'

const busy = (): RuntimeExecution => ({ state: 'active', observedAt: performance.now() })
const idle: RuntimeExecution = { state: 'idle', observedAt: performance.now() }

test('finished threads are offered for archiving and running ones are kept', () => {
  const conversations = [
    { sessionId: 'p' },
    { sessionId: 'done', parentSessionId: 'p', runtimeState: idle },
    { sessionId: 'busy', parentSessionId: 'p' },
    { sessionId: 'waiting', parentSessionId: 'p', runtimeState: { ...busy(), permissionWaits: 1 } },
    { sessionId: 'other', parentSessionId: 'x' },
  ]
  const live = new Map([['busy', busy()]])

  assert.deepEqual(threadsUnder('p', conversations, live), {
    finished: ['done'],
    running: ['busy', 'waiting'],
  })
})

test('a thread whose own thread is still running is not finished', () => {
  const conversations = [
    { sessionId: 'a', parentSessionId: 'p', runtimeState: idle },
    { sessionId: 'a1', parentSessionId: 'a' },
    { sessionId: 'b', parentSessionId: 'p', runtimeState: idle },
    { sessionId: 'b1', parentSessionId: 'b', runtimeState: idle },
  ]

  assert.deepEqual(threadsUnder('p', conversations, new Map([['a1', busy()]])), {
    finished: ['b1', 'b'],
    running: ['a1', 'a'],
  })
})

test('thread states match the in-chat badges', () => {
  assert.equal(threadState(busy()), 'running')
  assert.equal(threadState({ ...busy(), permissionWaits: 1 }), 'waiting')
  assert.equal(threadState(idle), 'done')
  assert.equal(threadState({ ...idle, state: 'interrupted' }), 'stopped')
  assert.equal(threadState(undefined), 'done')
})

test("a teammate's thread is never offered, and one without a snapshot stays", () => {
  const conversations = [
    { sessionId: 'p' },
    { sessionId: 'mine', parentSessionId: 'p', runtimeState: idle },
    { sessionId: 'theirs', parentSessionId: 'p', runtimeState: idle, readOnly: true },
    { sessionId: 'unknown', parentSessionId: 'p' },
  ]

  assert.deepEqual(threadsUnder('p', conversations, new Map()), {
    finished: ['mine'],
    running: ['unknown'],
  })
})
