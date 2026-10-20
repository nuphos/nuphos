import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  acceptRuntimeSnapshot,
  runtimeIsExecuting,
  runtimeAllows,
  runtimeBackgroundRunning,
  runtimeTurnActive,
  runtimeStateLabel,
  chatRowIndicator,
} from './runtimeExecution.ts'

import type { RuntimeExecution } from './runtimeExecution.ts'

test('only runtime active authorizes execution; unknown and transport loss fail closed', () => {
  for (const state of [
    'idle',
    'dormant',
    'interrupted',
    'unknown',
    'disconnected',
    'unsupported',
  ] as const)
    assert.equal(runtimeIsExecuting({ state }), false)
  assert.equal(runtimeIsExecuting(undefined), false)
  assert.equal(runtimeIsExecuting({ state: 'active' }), true)
})

test('an old active snapshot cannot revive a completed turn; a new process has its own revisions', () => {
  const idle = { state: 'idle' as const, epoch: 'process-1', revision: 8 }

  assert.deepEqual(
    acceptRuntimeSnapshot(idle, { state: 'active', epoch: 'process-1', revision: 7 }),
    idle,
  )
  assert.equal(
    acceptRuntimeSnapshot(idle, { state: 'unknown', epoch: 'process-2', revision: 0 }).state,
    'unknown',
  )
  assert.equal(acceptRuntimeSnapshot(idle, { state: 'disconnected' }).state, 'disconnected')
})

test('within one runtime process the higher revision wins whichever arrives last', () => {
  const active = { state: 'active' as const, epoch: 'a', revision: 1 }
  const idle = { state: 'idle' as const, epoch: 'a', revision: 2 }

  assert.equal(acceptRuntimeSnapshot(active, idle), idle)
  assert.equal(acceptRuntimeSnapshot(idle, active), idle)
})

test('across runtime processes, or without a revision, the later arrival wins', () => {
  const active = { state: 'active' as const, epoch: 'a', revision: 100 }
  const restarted = { state: 'unknown' as const, epoch: 'b', revision: 0 }
  const resting = { state: 'dormant' as const, schemaVersion: 2 }

  assert.equal(acceptRuntimeSnapshot(active, restarted), restarted)
  assert.equal(acceptRuntimeSnapshot(restarted, active), active)
  assert.equal(acceptRuntimeSnapshot(active, resting), resting)
  assert.equal(acceptRuntimeSnapshot(resting, active), active)
})

test('runtime capabilities distinguish replying to a request from starting a new turn', () => {
  const snapshot = {
    schemaVersion: 2,
    state: 'active' as const,
    actions: { send: false, cancel: true, steer: false, reply: true },
  }

  assert.equal(runtimeAllows(snapshot, 'send'), false)
  assert.equal(runtimeAllows(snapshot, 'reply'), true)
  assert.equal(runtimeAllows(snapshot, 'cancel'), true)
})
function observed(state: RuntimeExecution['state'], phase: string): RuntimeExecution {
  return { schemaVersion: 2, state, phase }
}

test('a running turn shows the spinner and outranks background work and unread', () => {
  for (const phase of ['thinking', 'running_tools', 'resume_pending', 'resuming', 'finishing']) {
    assert.equal(chatRowIndicator(observed('active', phase), false), 'turn')
    assert.equal(chatRowIndicator(observed('active', phase), true), 'turn')
  }
})

test('background work after the turn ended is its own state, not a running turn', () => {
  const background = observed('idle', 'background_tools')

  assert.equal(runtimeTurnActive(background), false)
  assert.equal(runtimeIsExecuting(background), false)
  assert.equal(runtimeBackgroundRunning(background), true)
  assert.equal(chatRowIndicator(background, false), 'background')
  assert.equal(chatRowIndicator(background, true), 'background')
})

test('a stopped runtime shows the error indicator; a missing snapshot does not', () => {
  for (const state of ['disconnected', 'interrupted', 'unknown', 'unsupported'] as const)
    assert.equal(chatRowIndicator({ state }, false), 'error')
  assert.equal(chatRowIndicator(observed('dormant', 'dormant'), false), 'none')
  assert.equal(chatRowIndicator(undefined, false), 'none')
})

test('an idle conversation shows only its unread state', () => {
  assert.equal(chatRowIndicator(observed('idle', 'idle'), true), 'unread')
  assert.equal(chatRowIndicator(observed('idle', 'idle'), false), 'none')
  assert.equal(chatRowIndicator(undefined, true), 'unread')
})

test('background work clears when tools finish, fail or are cancelled', () => {
  for (const phase of ['idle', 'failed', 'cancelled', 'dormant']) {
    assert.equal(runtimeBackgroundRunning(observed('idle', phase)), false)
  }
  assert.equal(chatRowIndicator(observed('idle', 'cancelled'), true), 'unread')
  assert.equal(chatRowIndicator(observed('idle', 'failed'), true), 'error')
})

test('a failed turn reads its own label; a disconnected runtime says so', () => {
  assert.equal(
    runtimeStateLabel({ ...observed('idle', 'failed'), label: 'Agent failed' }),
    'Agent failed',
  )
  assert.equal(
    runtimeStateLabel({ state: 'disconnected' }),
    'Connection lost — agent status unavailable',
  )
})

test('a lost runtime observation never leaves background work showing', () => {
  const background = observed('idle', 'background_tools')

  assert.equal(runtimeBackgroundRunning({ ...background, schemaVersion: 1 }), false)
  assert.equal(
    chatRowIndicator(acceptRuntimeSnapshot(background, { state: 'disconnected' }), false),
    'error',
  )
})

test('a paused automatic continuation is neither a running turn nor background work', () => {
  const paused = observed('active', 'resume_disconnected')

  assert.equal(runtimeTurnActive(paused), false)
  assert.equal(runtimeBackgroundRunning(paused), false)
  assert.equal(chatRowIndicator(paused, false), 'error')
})
