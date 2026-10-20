import assert from 'node:assert/strict'
import test from 'node:test'

import { runtimeStateOf } from '../../../lib/agentRuntimeStates.ts'
import { runtimeAllows } from '../../../lib/runtimeExecution.ts'

import { handleRuntimeStateFrame } from './runtimeStateFrame.ts'

import type { Tab } from './model.ts'

test('SSE runtime frames land in the shared store, ordered by the runtime revision', () => {
  let tabs = [
    { streamId: 's', sessionId: 'frame-session', streaming: false },
    { streamId: 'other', sessionId: 'frame-other' },
  ] as Tab[]
  let flushed = false
  const ctx = {
    setTabs: (next: Tab[] | ((previous: Tab[]) => Tab[])) => {
      tabs = typeof next === 'function' ? next(tabs) : next
    },
    flushTextBuffer: (_streamId: string) => {
      flushed = true
    },
    tabsRef: {
      get current() {
        return tabs
      },
    },
  }
  const snapshot = {
    schemaVersion: 2,
    epoch: 'e',
    revision: 2,
    state: 'active',
    phase: 'waiting_for_input',
    label: 'Waiting for access approval',
    requests: [{ waitId: 'w', kind: 'permission-grant', createdAt: 1 }],
    tools: [],
    actions: { send: false, cancel: true, steer: false, reply: true },
  }

  assert.equal(handleRuntimeStateFrame(ctx, 's', { type: 'runtime-state', snapshot }), true)
  assert.equal(flushed, true)
  assert.equal(tabs[0]?.streaming, false)
  assert.equal(tabs[0]?.claudeCodeRuntimeAttached, true)
  assert.equal(runtimeStateOf('frame-session')?.label, snapshot.label)
  assert.deepEqual(runtimeStateOf('frame-session')?.requests, snapshot.requests)
  assert.equal(runtimeAllows(runtimeStateOf('frame-session'), 'reply'), true)
  assert.equal(runtimeStateOf('frame-other'), undefined)
  handleRuntimeStateFrame(ctx, 's', {
    type: 'runtime-state',
    snapshot: { ...snapshot, revision: 1, state: 'idle' },
  })
  assert.equal(runtimeStateOf('frame-session')?.state, 'active', 'an older revision is ignored')
  assert.equal(handleRuntimeStateFrame(ctx, 's', { type: 'phase', phase: 'thinking' }), false)
})
