import assert from 'node:assert/strict'
import test from 'node:test'

import {
  runBelongsToThisClient,
  CLIENT_TOOL_PHASE_STALL_MS,
  clientToolPhaseStallText,
  clientToolPhaseStalled,
  clientToolPhaseNeedsDispatch,
  pendingClientSideLocalTools,
} from './clientToolPhase.ts'

const localExec = (over: Record<string, unknown> = {}) => ({
  type: 'tool',
  toolName: 'port_forward_start',
  state: 'input-available',
  toolCallId: 'call-1',
  ...over,
})

const assistant = (parts: Record<string, unknown>[]) =>
  [{ role: 'assistant', parts }] as unknown as Parameters<typeof pendingClientSideLocalTools>[0]

test('claims a local tool call the backend left for this machine', () => {
  assert.equal(pendingClientSideLocalTools(assistant([localExec()])).length, 1)
})

test('ignores a call that already ran', () => {
  assert.equal(
    pendingClientSideLocalTools(assistant([localExec({ state: 'output-available' })])).length,
    0,
  )
})

test('ignores server-side tools', () => {
  assert.equal(pendingClientSideLocalTools(assistant([localExec({ toolName: 'bash' })])).length, 0)
})

// The dangerous case: running these here would execute a command the user has
// not approved (and never will, if they deny it).
test('leaves an approval-pending call to the approval dialog', () => {
  assert.equal(
    pendingClientSideLocalTools(assistant([localExec({ approval: { id: 'a1' } })])).length,
    0,
  )
  assert.equal(
    pendingClientSideLocalTools(assistant([localExec({ approval: { id: 'a1', approved: false } })]))
      .length,
    0,
  )
  assert.equal(
    pendingClientSideLocalTools(assistant([localExec({ approval: { id: 'a1', approved: true } })]))
      .length,
    1,
  )
})

test('only looks at the last message, and only when the agent spoke last', () => {
  const messages = [
    { role: 'assistant', parts: [localExec()] },
    { role: 'user', parts: [{ type: 'text', text: 'hi' }] },
  ] as unknown as Parameters<typeof pendingClientSideLocalTools>[0]

  assert.equal(pendingClientSideLocalTools(messages).length, 0)
})

const phase = (over: Record<string, unknown> = {}) => ({
  streaming: true,
  streamId: null,
  streamStartedAt: 1_000,
  ...over,
})

test('phase stall fires once the phase has been silent past the limit', () => {
  assert.equal(clientToolPhaseStalled(phase(), 1_000 + CLIENT_TOOL_PHASE_STALL_MS), true)
})

test('phase stall holds off while the phase is still young', () => {
  assert.equal(clientToolPhaseStalled(phase(), 1_000 + CLIENT_TOOL_PHASE_STALL_MS - 1), false)
})

// A stream-owned turn has its own watchdogs; this one must not double-fire on it.
test('phase stall ignores a turn that a stream still owns', () => {
  assert.equal(
    clientToolPhaseStalled(phase({ streamId: 'stream-1' }), 1_000 + CLIENT_TOOL_PHASE_STALL_MS),
    false,
  )
})

test('phase stall ignores an idle tab', () => {
  assert.equal(
    clientToolPhaseStalled(phase({ streaming: false }), 1_000 + CLIENT_TOOL_PHASE_STALL_MS),
    false,
  )
})

// The regression that made this phase invisible: streaming with no clock.
test('phase stall ignores a phase with no clock rather than firing immediately', () => {
  assert.equal(clientToolPhaseStalled(phase({ streamStartedAt: null }), 10 ** 12), false)
})

test('stall text names the tools that went silent, without repeating one', () => {
  assert.equal(
    clientToolPhaseStallText([
      { toolName: 'port_forward_start' },
      { toolName: 'port_forward_start' },
    ]),
    'port_forward_start never reported back on this machine (no result after 90s).',
  )
})

test('a committed unclaimed client-tool phase owns its own dispatch', () => {
  const tab = {
    streaming: true,
    streamId: null,
    messages: assistant([localExec()]),
  }

  assert.equal(clientToolPhaseNeedsDispatch(tab, false), true)
  assert.equal(clientToolPhaseNeedsDispatch(tab, true), false)
})

test('a run belongs to the client that started it', () => {
  // The device that started this turn: its own stream is ending, so the
  // pending local tool is its job.
  assert.equal(runBelongsToThisClient({ attachedStreamId: null }, 'stream-a'), true)
  assert.equal(runBelongsToThisClient({}, 'stream-a'), true)
  // A device that attached to another device's run must not run the tool:
  // both would execute the same command.
  assert.equal(runBelongsToThisClient({ attachedStreamId: 'stream-a' }, 'stream-a'), false)
  // A stale marker from an earlier attach cannot block a turn this device
  // starts itself, because that turn has a stream id of its own.
  assert.equal(runBelongsToThisClient({ attachedStreamId: 'stream-a' }, 'stream-b'), true)
})
