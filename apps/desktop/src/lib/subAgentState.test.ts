import assert from 'node:assert/strict'
import { test } from 'node:test'

import { isSubAgentActive, rowDot, rowIndicator, subAgentState } from './subAgentState.ts'

import type { RuntimeExecution } from './runtimeExecution.ts'
import type { AgentInputRequest } from '../api/agent-types.ts'

const turn: RuntimeExecution = { state: 'active' }
const background: RuntimeExecution = { state: 'idle', schemaVersion: 2, phase: 'background_tools' }
const idle: RuntimeExecution = { state: 'idle' }
const stopped: RuntimeExecution = { state: 'interrupted' }
const disconnected: RuntimeExecution = { state: 'disconnected' }

function request(status: AgentInputRequest['status']): AgentInputRequest {
  return {
    id: 'q1',
    category: 'preference',
    question: 'Which region?',
    askedAt: '2026-10-29T00:00:00Z',
    status,
  }
}

const legacy = {
  category: 'preference',
  question: 'Which region?',
  toolCallId: 'q1',
  askedAt: '2026-10-29T00:00:00Z',
}

test('an open question makes a sub-agent wait, whether listed or legacy, even while it runs', () => {
  assert.equal(subAgentState({ inputRequests: [request('open')] }, idle), 'waiting')
  assert.equal(subAgentState({ pendingDecision: legacy }, turn), 'waiting')
})

test('a running turn or background work runs', () => {
  assert.equal(subAgentState({}, turn), 'running')
  assert.equal(subAgentState({}, background), 'running')
})

test('answered questions, idle, stopped, disconnected and unknown runtimes are done', () => {
  assert.equal(subAgentState({ inputRequests: [request('answered')] }, idle), 'done')
  assert.equal(subAgentState({}, stopped), 'done')
  assert.equal(subAgentState({}, disconnected), 'done')
  assert.equal(subAgentState({}, undefined), 'done')
})

test('waiting and running sub-agents are active, done ones are not', () => {
  assert.equal(isSubAgentActive({ pendingDecision: legacy }, undefined), true)
  assert.equal(isSubAgentActive({}, background), true)
  assert.equal(isSubAgentActive({}, idle), false)
})

test('a thread ignores its unread state, whatever it is doing', () => {
  const thread = { parentSessionId: 'parent' }

  assert.equal(rowDot(thread, idle, true), null)
  assert.equal(rowDot(thread, undefined, true), null)
  assert.equal(rowDot(thread, { ...idle, phase: 'stopped' }, true), null)
  assert.equal(rowDot(thread, turn, true), null)
  assert.equal(rowDot(thread, background, true), null)
  assert.equal(rowDot(thread, { ...idle, phase: 'failed' }, true), null)
})

test('a thread with an open question has a dot, read or not', () => {
  const waiting = { parentSessionId: 'parent', inputRequests: [request('open')] }

  assert.equal(rowDot(waiting, idle, true), 'waiting')
  assert.equal(rowDot(waiting, idle, false), 'waiting')
  assert.equal(rowDot({ ...waiting, inputRequests: [request('answered')] }, idle, true), null)
})

test('a top level chat has a dot while it is unread', () => {
  assert.equal(rowDot({}, idle, true), 'unread')
  assert.equal(rowDot({}, undefined, true), 'unread')
  assert.equal(rowDot({}, idle, false), null)
  assert.equal(rowDot({ inputRequests: [request('open')] }, idle, false), null)
})

test('an open question outranks work but not a failed run', () => {
  assert.equal(rowIndicator(idle, 'waiting'), 'waiting')
  assert.equal(rowIndicator(turn, 'waiting'), 'waiting')
  assert.equal(rowIndicator(background, 'waiting'), 'waiting')
  assert.equal(rowIndicator({ ...idle, schemaVersion: 2, phase: 'failed' }, 'waiting'), 'error')
})

test('an unread reply still loses to work', () => {
  assert.equal(rowIndicator(idle, 'unread'), 'unread')
  assert.equal(rowIndicator(turn, 'unread'), 'turn')
  assert.equal(rowIndicator(background, 'unread'), 'background')
  assert.equal(rowIndicator(idle, null), 'none')
})
