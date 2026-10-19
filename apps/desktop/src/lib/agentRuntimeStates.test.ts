import assert from 'node:assert/strict'
import test from 'node:test'

import { selectClientToolDispatch } from '../components/agent/panel/clientToolRequests.ts'

import { publishRuntimeStates, runtimeStateOf } from './agentRuntimeStates.ts'

import type { Tab } from '../components/agent/panel/model.ts'
import type { RuntimeExecution } from './runtimeExecution.ts'

const request = {
  waitId: 'call-a',
  kind: 'client-tool',
  ref: 'port_forward_start',
  clientTool: {
    toolName: 'port_forward_start',
    input: { command: 'kubectl get pods' },
    streamId: 'stream-a',
  },
  createdAt: 1,
}
const messages = [{ id: 'u1', role: 'user', parts: [{ type: 'text', text: 'list pods' }] }]
const dispatchFor = (runtimeState: RuntimeExecution | undefined) =>
  selectClientToolDispatch(
    { messages, runtimeState } as unknown as Tab,
    (streamId) => streamId === 'stream-a',
    () => false,
  )

test('a late reading from a retired runtime process never becomes current', () => {
  const session = 'retired-epoch'
  const oldActive: RuntimeExecution = {
    schemaVersion: 2,
    state: 'active',
    epoch: 'process-a',
    revision: 9,
    requests: [request],
  }
  const newIdle: RuntimeExecution = {
    schemaVersion: 2,
    state: 'idle',
    epoch: 'process-b',
    revision: 0,
  }

  publishRuntimeStates([[session, { ...oldActive, requests: [] }]])
  publishRuntimeStates([[session, newIdle]])
  // A detail request or replayed frame started on process A lands after B.
  publishRuntimeStates([[session, oldActive]])

  assert.equal(runtimeStateOf(session), newIdle)
  const tab = {
    sessionId: session,
    streamId: 'stream-a',
    messages: [],
    runtimeState: runtimeStateOf(session),
  } as unknown as Tab

  assert.equal(
    selectClientToolDispatch(
      tab,
      () => true,
      () => false,
    ),
    null,
    'no obsolete client tool is dispatched',
  )
})

test('a resting reading in between does not let the retired process back in', () => {
  const session = 'retired-after-resting'

  publishRuntimeStates([[session, { state: 'active', epoch: 'a', revision: 1 }]])
  publishRuntimeStates([[session, { state: 'dormant', schemaVersion: 2 }]])
  publishRuntimeStates([[session, { state: 'idle', epoch: 'b', revision: 0 }]])
  publishRuntimeStates([[session, { state: 'active', epoch: 'a', revision: 5 }]])

  assert.equal(runtimeStateOf(session)?.epoch, 'b')
})
