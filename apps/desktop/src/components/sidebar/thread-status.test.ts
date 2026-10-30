import assert from 'node:assert/strict'
import { test } from 'node:test'

import { nestItems } from './nest-items.ts'
import { threadFoldsAway } from './thread-status.ts'

import type { AgentInputRequest } from '../../api/agent-types.ts'
import type { RuntimeExecution } from '../../lib/runtimeExecution.ts'

const idle: RuntimeExecution = { state: 'idle', schemaVersion: 2 }
const turn: RuntimeExecution = { state: 'active', schemaVersion: 2, phase: 'running' }
const background: RuntimeExecution = { state: 'idle', schemaVersion: 2, phase: 'background_tools' }
const question = { id: 'q1', status: 'open', askedAt: '2026-10-29T10:00:00Z' } as AgentInputRequest
const base = { conversation: {}, runtimeState: idle, open: false, unread: false }

test('a done thread folds away unless it is open or unread', () => {
  assert.equal(threadFoldsAway(base), true)
  assert.equal(threadFoldsAway({ ...base, runtimeState: undefined }), true)
  assert.equal(threadFoldsAway({ ...base, runtimeState: { state: 'disconnected' } }), true)
  assert.equal(threadFoldsAway({ ...base, open: true }), false)
  assert.equal(threadFoldsAway({ ...base, unread: true }), false)
})

test('a running or asking thread stays listed', () => {
  assert.equal(threadFoldsAway({ ...base, runtimeState: turn }), false)
  assert.equal(threadFoldsAway({ ...base, runtimeState: background }), false)
  assert.equal(threadFoldsAway({ ...base, conversation: { inputRequests: [question] } }), false)
})

test('a failed run stays listed and a run the user stopped folds', () => {
  assert.equal(threadFoldsAway({ ...base, runtimeState: { ...idle, phase: 'failed' } }), false)
  assert.equal(
    threadFoldsAway({ ...base, runtimeState: { ...idle, phase: 'resume_failed' } }),
    false,
  )
  assert.equal(threadFoldsAway({ ...base, runtimeState: { ...idle, phase: 'stopped' } }), true)
})

/** The rows a parent and its one thread produce for a given runtime state. */
function rows(runtimeState: RuntimeExecution) {
  return nestItems([
    { key: 'parent' },
    { key: 'thread', parentKey: 'parent', finished: threadFoldsAway({ ...base, runtimeState }) },
  ])
}

test('a counted thread is listed again once a newer state says it runs', () => {
  assert.deepEqual(
    rows(idle).map(({ item }) => item.key),
    ['parent'],
  )
  assert.deepEqual(
    rows(turn).map(({ item }) => item.key),
    ['parent', 'thread'],
  )
})
