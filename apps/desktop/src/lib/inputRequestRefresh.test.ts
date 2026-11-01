import assert from 'node:assert/strict'
import { mock, test } from 'node:test'

import {
  isDecisionToolName,
  noteInputRequestFrame,
  onInputRequestsRefresh,
  runtimeStatesKey,
} from './inputRequestRefresh.ts'

import type { RuntimeExecution } from './runtimeExecution.ts'

test('decision tools are recognized with or without a provider prefix', () => {
  assert.equal(isDecisionToolName('request_user_decision'), true)
  assert.equal(isDecisionToolName('mcp__nuphos-tools__request_user_decision'), true)
  assert.equal(isDecisionToolName('nuphos-tools.request_user_decision'), true)
  assert.equal(isDecisionToolName('not_request_user_decision'), false)
  assert.equal(isDecisionToolName(undefined), false)
})

test('stream frames of a decision call or a turn boundary refresh; other tools do not', () => {
  mock.timers.enable({ apis: ['setTimeout'] })
  let refreshes = 0
  const stop = onInputRequestsRefresh(() => {
    refreshes += 1
  })

  noteInputRequestFrame({ type: 'tool-input-available', toolCallId: 'shell', toolName: 'bash' })
  noteInputRequestFrame({ type: 'tool-output-available', toolCallId: 'shell' })
  assert.equal(refreshes, 0)
  noteInputRequestFrame({
    type: 'tool-input-start',
    toolCallId: 'ask',
    toolName: 'mcp__nuphos-tools__request_user_decision',
  })
  assert.equal(refreshes, 0)
  noteInputRequestFrame({ type: 'tool-input-available', toolCallId: 'ask' })
  assert.equal(refreshes, 1)
  // The result frame names no tool; the call id seen asking is enough.
  noteInputRequestFrame({ type: 'tool-output-available', toolCallId: 'ask' })
  assert.equal(refreshes, 2)
  // Once more after the backend has recorded the question.
  mock.timers.tick(1_000)
  assert.equal(refreshes, 3)
  noteInputRequestFrame({ type: 'tool-output-available', toolCallId: 'ask' })
  mock.timers.tick(1_000)
  assert.equal(refreshes, 3)
  noteInputRequestFrame({ type: 'start' })
  noteInputRequestFrame({ type: 'text-delta', delta: 'hi' })
  assert.equal(refreshes, 4)
  noteInputRequestFrame(undefined)
  stop()
  noteInputRequestFrame({
    type: 'tool-input-available',
    toolCallId: 'later',
    toolName: 'request_user_decision',
  })
  assert.equal(refreshes, 4)
  mock.timers.reset()
})

test('the runtime key changes when a watched session starts, stops or waits', () => {
  const idle = new Map<string, RuntimeExecution>([['child', { state: 'idle' }]])
  const active = new Map<string, RuntimeExecution>([['child', { state: 'active' }]])
  const waiting = new Map<string, RuntimeExecution>([
    ['child', { state: 'active', requestPending: true }],
  ])

  assert.notEqual(runtimeStatesKey(idle, ['child']), runtimeStatesKey(active, ['child']))
  assert.notEqual(runtimeStatesKey(active, ['child']), runtimeStatesKey(waiting, ['child']))
  assert.equal(runtimeStatesKey(active, ['other']), runtimeStatesKey(idle, ['other']))
})
