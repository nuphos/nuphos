import assert from 'node:assert/strict'
import test from 'node:test'

import { computeStatus } from './status.ts'

import type { Message, Tab } from './model.ts'

const message = {
  role: 'assistant',
  parts: [{ type: 'tool', state: 'input-available' }],
} as Message

function tab(label: string, state: 'idle' | 'active' = 'active'): Tab {
  return {
    sessionId: 's',
    claudeCodeRuntimeAttached: true,
    messages: [message],
    streaming: true,
    phase: 'thinking',
    runtimeState: { schemaVersion: 2, state, label },
  } as Tab
}
test('runtime labels override stale local streaming, phase and unfinished cards', () => {
  for (const label of ['Waiting for approval', 'Finishing the request…', 'Agent: rate_limited']) {
    assert.deepEqual(computeStatus(tab(label), message), { label })
  }
})
test('an unreachable or outdated runtime adds no line; the agent dot says it', () => {
  const current = tab('unused')

  for (const runtimeState of [
    { state: 'disconnected' as const },
    { state: 'unsupported' as const },
    { state: 'active' as const, label: 'Thinking…' },
  ]) {
    current.runtimeState = runtimeState
    assert.equal(computeStatus(current, message), null)
  }
})

test('optimistic first message does not imply a lost runtime connection', () => {
  const current = tab('unused')

  current.claudeCodeRuntimeAttached = false
  current.runtimeState = undefined
  assert.equal(computeStatus(current, message)?.label, 'Connecting…')
})

test('an opened conversation awaiting its first runtime read shows no status', () => {
  const current = tab('unused')

  current.runtimeState = undefined
  assert.equal(computeStatus(current, message), null)
})

test('idle and dormant runtimes do not add readiness text to the conversation', () => {
  for (const state of ['idle', 'dormant'] as const) {
    const current = tab(state === 'idle' ? 'Ready' : 'Ready to start')

    current.runtimeState = { ...current.runtimeState!, state, phase: state }
    assert.equal(computeStatus(current, message), null)
  }
})
test('a stopped turn leaves no status line under the transcript', () => {
  const current = tab('Stopped', 'idle')

  current.runtimeState!.phase = 'cancelled'
  assert.equal(computeStatus(current, message), null)
})
test('background work stays visible even when the provider is idle', () => {
  const current = tab('Background tools running', 'idle')

  current.runtimeState!.phase = 'background_tools'
  assert.equal(computeStatus(current, message)?.label, 'Background tools running')
})
test('running shells are left to the composer chip instead of a transcript line', () => {
  const current = tab('Background tools are still running', 'idle')

  current.runtimeState!.phase = 'background_tools'
  current.runtimeState!.tools = [
    { id: 't1', terminal: { terminalId: 't1', command: 'sleep 30', status: 'running' } },
  ]
  assert.equal(computeStatus(current, message), null)
})
test('a failed turn that explains itself does not also claim the session was interrupted', () => {
  const failed = {
    role: 'assistant',
    parts: [
      { type: 'text', text: '我查一下目前' },
      { type: 'turn-interrupted', id: 'i', reason: 'error', message: 'blocked', createdAt: '' },
    ],
  } as Message
  const current = tab('Session interrupted', 'idle')

  current.runtimeState = {
    ...current.runtimeState!,
    state: 'interrupted',
    phase: 'interrupted',
    actions: { send: true, cancel: false, steer: false },
  }
  current.messages = [failed]
  assert.equal(computeStatus(current, failed), null)
  assert.equal(computeStatus(current, message)?.label, 'Session interrupted')

  current.runtimeState.actions = { send: false, cancel: false, steer: false }
  assert.equal(computeStatus(current, failed)?.label, 'Session interrupted')
})
