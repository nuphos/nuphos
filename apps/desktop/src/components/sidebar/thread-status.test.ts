import assert from 'node:assert/strict'
import { test } from 'node:test'

import { threadDone, threadFoldsAway } from './thread-status.ts'

import type { AgentInputRequest } from '../../api/agent-types.ts'
import type { RuntimeExecution } from '../../lib/runtimeExecution.ts'

const idle: RuntimeExecution = { state: 'idle', schemaVersion: 2 }
const turn: RuntimeExecution = { state: 'active', schemaVersion: 2, phase: 'running' }
const background: RuntimeExecution = { state: 'idle', schemaVersion: 2, phase: 'background_tools' }
const stopped: RuntimeExecution = { state: 'disconnected' }
const question = {
  id: 'q1',
  status: 'open',
  askedAt: '2026-10-29T10:00:00Z',
} as AgentInputRequest

test('a thread is done once nothing runs and nothing waits on the viewer', () => {
  assert.equal(threadDone({}, idle), true)
  assert.equal(threadDone({}, undefined), true)
  assert.equal(threadDone({}, stopped), true)
  assert.equal(threadDone({}, turn), false)
  assert.equal(threadDone({}, background), false)
  assert.equal(threadDone({ inputRequests: [question] }, idle), false)
  assert.equal(threadDone({ inputRequests: [{ ...question, status: 'answered' }] }, idle), true)
})

test('a done thread stays listed while it is open or unread', () => {
  const base = { conversation: {}, runtimeState: idle, open: false, unread: false }

  assert.equal(threadFoldsAway(base), true)
  assert.equal(threadFoldsAway({ ...base, open: true }), false)
  assert.equal(threadFoldsAway({ ...base, unread: true }), false)
  assert.equal(threadFoldsAway({ ...base, runtimeState: turn }), false)
})

test('a failed run stays listed and a run the user stopped folds', () => {
  const base = { conversation: {}, open: false, unread: false }

  assert.equal(threadFoldsAway({ ...base, runtimeState: { ...idle, phase: 'failed' } }), false)
  assert.equal(
    threadFoldsAway({ ...base, runtimeState: { ...idle, phase: 'resume_failed' } }),
    false,
  )
  assert.equal(threadFoldsAway({ ...base, runtimeState: { ...idle, phase: 'stopped' } }), true)
})
