import assert from 'node:assert/strict'
import test from 'node:test'

import { threadsUnder } from './threadLifecycle.ts'

import type { RuntimeExecution } from './runtimeExecution.ts'

const busy = (): RuntimeExecution => ({ state: 'active', observedAt: performance.now() })
const idle: RuntimeExecution = { state: 'idle', observedAt: performance.now() }

test('finished threads are offered for archiving and running ones are kept', () => {
  const conversations = [
    { sessionId: 'p' },
    { sessionId: 'done', parentSessionId: 'p', runtimeState: idle },
    { sessionId: 'busy', parentSessionId: 'p' },
    { sessionId: 'waiting', parentSessionId: 'p', runtimeState: { ...idle, requestPending: true } },
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
    { sessionId: 'a', parentSessionId: 'p' },
    { sessionId: 'a1', parentSessionId: 'a' },
    { sessionId: 'b', parentSessionId: 'p' },
    { sessionId: 'b1', parentSessionId: 'b' },
  ]

  assert.deepEqual(threadsUnder('p', conversations, new Map([['a1', busy()]])), {
    finished: ['b1', 'b'],
    running: ['a1', 'a'],
  })
})
