import assert from 'node:assert/strict'
import test from 'node:test'

import { runtimeAllows } from '../../../lib/runtimeExecution.ts'

import { handleRuntimeStateFrame } from './runtimeStateFrame.ts'

import type { Tab } from './model.ts'

test('SSE runtime frames render complete runtime facts without inferring from transport', () => {
  let tabs = [
    { streamId: 's', streaming: false, runtimeState: undefined },
    { streamId: 'other' },
  ] as Tab[]
  let flushed = false
  const ctx = {
    setTabs: (next: Tab[] | ((previous: Tab[]) => Tab[])) => {
      tabs = typeof next === 'function' ? next(tabs) : next
    },
    flushTextBuffer: (_streamId: string) => {
      flushed = true
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

  assert.equal(
    handleRuntimeStateFrame(ctx, 's', { type: 'runtime-state', snapshot, emittedAt: Date.now() }),
    true,
  )
  assert.equal(flushed, true)
  assert.equal(tabs[0]?.streaming, false)
  assert.equal(tabs[0]?.runtimeState?.label, snapshot.label)
  assert.deepEqual(tabs[0]?.runtimeState?.requests, snapshot.requests)
  assert.equal(runtimeAllows(tabs[0]?.runtimeState, 'reply'), true)
  assert.equal(tabs[1]?.runtimeState, undefined)
  handleRuntimeStateFrame(ctx, 's', {
    type: 'runtime-state',
    snapshot: { ...snapshot, revision: 1, state: 'idle' },
    emittedAt: Date.now(),
  })
  assert.equal(tabs[0]?.runtimeState?.state, 'active')
  handleRuntimeStateFrame(ctx, 's', {
    type: 'runtime-state',
    snapshot: { ...snapshot, revision: 3 },
    emittedAt: Date.now() - 30_000,
  })
  assert.equal(
    runtimeAllows(tabs[0]?.runtimeState, 'reply'),
    false,
    'replayed frames cannot renew action capability',
  )
  assert.equal(handleRuntimeStateFrame(ctx, 's', { type: 'phase', phase: 'thinking' }), false)
})
