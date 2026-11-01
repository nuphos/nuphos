import assert from 'node:assert/strict'
import { test } from 'node:test'

import { routeSend } from './sendRouting.ts'

import type { RuntimeExecution } from '../../../lib/runtimeExecution.ts'

// A turn is running and takes steers; an idle agent takes replies.
const running = {
  state: 'active',
  schemaVersion: 2,
  actions: { send: true, cancel: true, steer: true },
} as RuntimeExecution
const idle = {
  state: 'idle',
  schemaVersion: 2,
  actions: { send: true, cancel: false, steer: false, reply: true },
} as RuntimeExecution

test('an explicit reply (reply composer, chip or card) names its question', () => {
  assert.deepEqual(routeSend(idle, undefined, 'q1'), { steer: false, decisionReplyTo: 'q1' })
})

test('a send without a question id answers nothing, so plan Reject and Request changes stay plain', () => {
  assert.deepEqual(routeSend(idle, undefined, undefined), { steer: false })
})

test('a send with a turn kind never answers a question, even if one is set', () => {
  assert.deepEqual(routeSend(idle, 'plan-approval', 'q1'), { steer: false })
})

test('steering is unchanged by an open question and never carries it', () => {
  assert.deepEqual(routeSend(running, undefined, 'q1'), { steer: true })
  assert.deepEqual(routeSend(running, undefined, undefined), { steer: true })
  // A turn kind still goes out as its own turn, as before.
  assert.deepEqual(routeSend(running, 'plan-approval', 'q1'), { steer: false })
})
