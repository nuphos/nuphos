import assert from 'node:assert/strict'
import test from 'node:test'

import { selectClientToolDispatch } from './clientToolRequests.ts'

import type { Message } from './model.ts'
import type { RuntimeRequest } from '../../../lib/runtimeExecution.ts'

const WAIT = 'nuphos-wait-1'
const OWN_STREAM = 'stream-mine'

const user: Message = { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'list pods' }] }
const streamedTurn: Message = {
  id: 'a1',
  role: 'assistant',
  parts: [
    {
      type: 'tool',
      toolCallId: WAIT,
      toolName: 'port_forward_start',
      state: 'input-available',
      input: { command: 'kubectl get pods' },
    },
  ],
}
const request = (over: Partial<RuntimeRequest> = {}): RuntimeRequest => ({
  waitId: WAIT,
  kind: 'client-tool',
  ref: 'port_forward_start',
  clientTool: {
    toolName: 'port_forward_start',
    input: { command: 'kubectl get pods' },
    streamId: OWN_STREAM,
  },
  createdAt: 1,
  ...over,
})
const ownsOnly = (id: string | undefined) => id === OWN_STREAM

/** One device's committed-state dispatcher, reduced to what it would run. */
function device(owns: (streamId: string | undefined) => boolean) {
  const claimed = new Set<string>()
  const executed: string[] = []

  return {
    executed,
    observe(tab: Parameters<typeof selectClientToolDispatch>[0]) {
      const dispatch = selectClientToolDispatch(tab, owns, (id) => claimed.has(id))

      if (!dispatch) return null
      for (const tool of dispatch.tools) {
        claimed.add(tool.toolCallId)
        executed.push(tool.toolCallId)
      }

      return dispatch
    },
  }
}

test('stream closes, request arrives late, transcript drops the card: runs exactly once', () => {
  const desktop = device(ownsOnly)

  // The stream ended before any snapshot listed the request: nothing to run yet.
  assert.equal(desktop.observe({ messages: [user, streamedTurn], runtimeState: {} }), null)

  // The persisted transcript replaces the turn; the streamed card is gone.
  const reloaded = [user]
  const recovered = desktop.observe({
    messages: reloaded,
    runtimeState: { requests: [request()] },
  })

  assert.deepEqual(desktop.executed, [WAIT])
  assert.equal(recovered?.messages.length, 2)
  assert.deepEqual(recovered?.messages[1]?.parts, [
    {
      type: 'tool',
      toolCallId: WAIT,
      toolName: 'port_forward_start',
      state: 'input-available',
      input: { command: 'kubectl get pods' },
      startedAt: 1,
    },
  ])

  // Later polls keep listing the request until the continuation lands.
  desktop.observe({ messages: reloaded, runtimeState: { requests: [request()] } })
  desktop.observe({ messages: recovered?.messages ?? [], runtimeState: { requests: [request()] } })
  assert.deepEqual(desktop.executed, [WAIT])
})

test('a streamed card never runs on a device that did not start the requesting stream', () => {
  const reopened = device(() => false)

  assert.equal(
    reopened.observe({ messages: [user, streamedTurn], runtimeState: { requests: [request()] } }),
    null,
  )
  assert.deepEqual(reopened.executed, [])
})

test('a request without an owner stream fails closed on a device that followed a run', () => {
  const follower = device(() => false)

  assert.equal(
    follower.observe({
      messages: [user, streamedTurn],
      attachedStreamId: 'stream-from-another-device',
      runtimeState: { requests: [request({ clientTool: { toolName: 'port_forward_start' } })] },
    }),
    null,
  )
})

test('a streamed card still runs when the request carries no call details', () => {
  const desktop = device(() => false)
  const dispatch = desktop.observe({
    messages: [user, streamedTurn],
    runtimeState: { requests: [request({ clientTool: undefined })] },
  })

  assert.equal(dispatch?.messages[1], streamedTurn)
  assert.deepEqual(desktop.executed, [WAIT])
})

test('the recovered card joins the open assistant message of the turn', () => {
  const partial: Message = {
    id: 'a1',
    role: 'assistant',
    parts: [{ type: 'text', text: 'Checking' }],
  }
  const dispatch = device(ownsOnly).observe({
    messages: [user, partial],
    runtimeState: { requests: [request()] },
  })

  assert.equal(dispatch?.messages.length, 2)
  assert.deepEqual(
    dispatch?.messages[1]?.parts.map((part) => part.type),
    ['text', 'tool'],
  )
})

test('another device of the same user never rebuilds and runs the call', () => {
  const other = device(() => false)

  assert.equal(other.observe({ messages: [user], runtimeState: { requests: [request()] } }), null)
  assert.deepEqual(other.executed, [])
})

test('a device following the requesting stream leaves even a streamed card to its owner', () => {
  const follower = device(() => false)

  assert.equal(
    follower.observe({
      messages: [user, streamedTurn],
      attachedStreamId: OWN_STREAM,
      runtimeState: { requests: [request()] },
    }),
    null,
  )
})

test('a call that already ran here is not rebuilt from a stale request', () => {
  const ran: Message = {
    ...streamedTurn,
    parts: [{ ...(streamedTurn.parts[0] as object), state: 'output-available', output: {} }],
  } as Message

  assert.equal(
    device(ownsOnly).observe({ messages: [user, ran], runtimeState: { requests: [request()] } }),
    null,
  )
})

test('only desktop-executed tools with a durable input are rebuilt', () => {
  const desktop = device(ownsOnly)

  assert.equal(
    desktop.observe({
      messages: [user],
      runtimeState: {
        requests: [
          request({ clientTool: { toolName: 'port_forward_start', streamId: OWN_STREAM } }),
          request({
            waitId: 'w2',
            clientTool: { toolName: 'bash', input: {}, streamId: OWN_STREAM },
          }),
          request({ waitId: 'w3', kind: 'permission-grant' }),
        ],
      },
    }),
    null,
  )
})
