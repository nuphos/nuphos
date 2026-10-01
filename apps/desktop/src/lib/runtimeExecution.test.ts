import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  acceptRuntimeSnapshot,
  newestRuntimeSnapshot,
  runtimeIsExecuting,
  runtimeAllows,
  runtimeBackgroundRunning,
  runtimeTurnActive,
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
  assert.equal(runtimeIsExecuting({ state: 'active', observedAt: performance.now() }), true)
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

test('a lost status connection cannot leave its last active snapshot running forever', () => {
  assert.equal(
    runtimeIsExecuting({ state: 'active', observedAt: performance.now() - 12_001 }),
    false,
  )
  assert.equal(runtimeIsExecuting({ state: 'active' }), false)
})

test('sidebar uses a newer stop observation instead of OR-ing an older active list row', () => {
  const active = { state: 'active' as const, epoch: 'a', revision: 1, observedAt: 100 }
  const idle = { state: 'idle' as const, epoch: 'a', revision: 2, observedAt: 90 }

  assert.equal(newestRuntimeSnapshot(active, idle), idle)
  assert.equal(newestRuntimeSnapshot(idle, active), idle)
})

test('new process and disconnected observations supersede older active observations', () => {
  const active = { state: 'active' as const, epoch: 'a', revision: 100, observedAt: 100 }
  const restarted = { state: 'unknown' as const, epoch: 'b', revision: 0, observedAt: 200 }
  const disconnected = { state: 'disconnected' as const, observedAt: 300 }

  assert.equal(newestRuntimeSnapshot(active, restarted), restarted)
  assert.equal(newestRuntimeSnapshot(restarted, active), restarted)
  assert.equal(newestRuntimeSnapshot(active, disconnected), disconnected)
  assert.equal(newestRuntimeSnapshot(disconnected, active), disconnected)
})

test('runtime capabilities distinguish replying to a request from starting a new turn', () => {
  const snapshot = {
    schemaVersion: 2,
    state: 'active' as const,
    observedAt: performance.now(),
    actions: { send: false, cancel: true, steer: false, reply: true },
  }

  assert.equal(runtimeAllows(snapshot, 'send'), false)
  assert.equal(runtimeAllows(snapshot, 'reply'), true)
  assert.equal(runtimeAllows(snapshot, 'cancel'), true)
})
test('late old-process observations cannot overwrite a new runtime process', () => {
  const current = { state: 'idle' as const, epoch: 'new', revision: 0, observedAt: 200 }
  const old = { state: 'active' as const, epoch: 'old', revision: 900, observedAt: 100 }

  assert.equal(acceptRuntimeSnapshot(current, old), current)
})

function observed(state: RuntimeExecution['state'], phase: string): RuntimeExecution {
  return { schemaVersion: 2, state, phase, observedAt: performance.now() }
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

test('an idle conversation shows only its unread state', () => {
  assert.equal(chatRowIndicator(observed('idle', 'idle'), true), 'unread')
  assert.equal(chatRowIndicator(observed('idle', 'idle'), false), 'none')
  assert.equal(chatRowIndicator(undefined, true), 'unread')
})

test('background work clears when tools finish, fail or are cancelled', () => {
  for (const phase of ['idle', 'failed', 'cancelled', 'dormant']) {
    assert.equal(runtimeBackgroundRunning(observed('idle', phase)), false)
    assert.equal(chatRowIndicator(observed('idle', phase), true), 'unread')
  }
})

test('a lost or stale runtime observation never leaves background work showing', () => {
  const background = observed('idle', 'background_tools')

  assert.equal(
    runtimeBackgroundRunning({ ...background, observedAt: performance.now() - 12_001 }),
    false,
  )
  assert.equal(runtimeBackgroundRunning({ ...background, observedAt: undefined }), false)
  assert.equal(runtimeBackgroundRunning({ ...background, schemaVersion: 1 }), false)
  assert.equal(
    chatRowIndicator(
      newestRuntimeSnapshot(background, {
        state: 'disconnected',
        observedAt: performance.now() + 1,
      }),
      false,
    ),
    'none',
  )
})

test('a paused automatic continuation is neither a running turn nor background work', () => {
  const paused = observed('active', 'resume_disconnected')

  assert.equal(runtimeTurnActive(paused), false)
  assert.equal(runtimeBackgroundRunning(paused), false)
  assert.equal(chatRowIndicator(paused, false), 'none')
  assert.equal(chatRowIndicator(paused, true), 'unread')
})
