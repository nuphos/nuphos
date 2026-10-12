import { describe, expect, test } from 'bun:test'

import { createLocalCuaHandler } from './local-cua'

import type { LocalCuaDeps } from './local-cua'
import type { PreviewToolContext } from '../preview-tool-context'

type Listener = (event: { data?: unknown }) => void

/** A device that answers each call with `respond`, recording what it was sent. */
function fakeDevice(respond: (call: Record<string, unknown>, socket: FakeSocket) => void) {
  const sockets: FakeSocket[] = []

  return {
    sockets,
    connect: () => {
      const socket = new FakeSocket(respond)

      sockets.push(socket)

      return socket
    },
  }
}

class FakeSocket {
  sent: Record<string, unknown>[] = []
  closed = false
  private listeners = new Map<string, Listener[]>()

  constructor(private respond: (call: Record<string, unknown>, socket: FakeSocket) => void) {}

  addEventListener(type: string, listener: Listener) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener])
  }

  emit(type: string, data?: unknown) {
    for (const listener of this.listeners.get(type) ?? [])
      listener(data === undefined ? {} : { data: JSON.stringify(data) })
  }

  send(data: string) {
    const message = JSON.parse(data) as Record<string, unknown>

    this.sent.push(message)
    this.respond(message, this)
  }

  close() {
    this.closed = true
  }

  async connect() {
    this.emit('open')
  }
}

const ctx: PreviewToolContext = {
  userId: 'u1',
  teamId: 't1',
  sessionId: 's1',
  turnKey: 'turn-1',
  locale: 'en',
}

function deps(overrides: Partial<LocalCuaDeps>): LocalCuaDeps {
  return {
    devices: async () => [{ deviceId: 'mac', label: 'MacBook' }],
    isMember: async () => true,
    connect: fakeDevice(() => {}).connect,
    approve: async () => true,
    publish: async () => {},
    audit: async () => {},
    timeoutMs: 1_000,
    ...overrides,
  }
}

const image = { type: 'image' as const, data: 'cG5n', mimeType: 'image/png' }

describe('local_cua', () => {
  test('relays the call with the conversation and turn, and returns the device result as-is', async () => {
    const device = fakeDevice((message, socket) => {
      if (message.t === 'call')
        socket.emit('message', {
          t: 'result',
          result: { content: [{ type: 'text', text: 'ok' }, image] },
        })
    })
    const frames: Record<string, unknown>[] = []
    const result = await createLocalCuaHandler(
      ctx,
      deps({
        connect: device.connect,
        publish: async (_ctx, frame) => {
          frames.push(frame)
        },
      }),
    )({ code: 'await cua.getState()' })

    expect(device.sockets[0]?.sent[0]).toEqual({
      t: 'call',
      session: 's1',
      turn: 'turn-1',
      code: 'await cua.getState()',
    })
    expect(result.content).toEqual([{ type: 'text', text: 'ok' }, image])
    expect(frames.at(-1)).toMatchObject({
      type: 'tool-output-available',
      output: [
        { type: 'text', text: 'ok' },
        { type: 'image', mimeType: 'image/png' },
      ],
    })
    expect(device.sockets[0]?.closed).toBe(true)
  })

  test("answers the App's approval prompt with the user's decision", async () => {
    const asked: string[] = []
    const device = fakeDevice((message, socket) => {
      if (message.t === 'call')
        socket.emit('message', { t: 'elicit', id: 'e1', message: 'Allow Finder?', meta: {} })
      if (message.t === 'elicit-reply')
        socket.emit('message', {
          t: 'result',
          result: { content: [{ type: 'text', text: String(message.accept) }] },
        })
    })
    const result = await createLocalCuaHandler(
      ctx,
      deps({
        connect: device.connect,
        approve: async (_ctx, _id, request) => {
          asked.push(request.message)

          return false
        },
      }),
    )({ code: 'let app = await cua.getApp("Finder")' })

    expect(asked).toEqual(['Allow Finder?'])
    expect(device.sockets[0]?.sent[1]).toEqual({ t: 'elicit-reply', id: 'e1', accept: false })
    expect(result.content).toEqual([{ type: 'text', text: 'false' }])
  })

  test('never reaches a device from a conversation the caller does not own', async () => {
    const device = fakeDevice(() => {})
    const result = await createLocalCuaHandler(
      { ...ctx, conversationOwnerUserId: 'someone-else' },
      deps({ connect: device.connect }),
    )({ code: 'await cua.getState()' })

    expect(result.isError).toBe(true)
    expect(device.sockets).toHaveLength(0)
  })

  test('asks for a device when several are selected', async () => {
    const result = await createLocalCuaHandler(
      ctx,
      deps({
        devices: async () => [
          { deviceId: 'm1', label: 'M1' },
          { deviceId: 'm5', label: 'M5' },
        ],
      }),
    )({ code: 'await cua.getState()' })

    expect(result.content[0]).toMatchObject({ text: expect.stringContaining('m1 (M1), m5 (M5)') })
  })

  test('a device that cannot serve Computer Use fails the call and is audited', async () => {
    const outcomes: string[] = []
    const device = fakeDevice(() => {})
    const result = await createLocalCuaHandler(
      ctx,
      deps({
        connect: () => {
          const socket = device.connect()

          socket.connect = async () => socket.emit('close')

          return socket
        },
        audit: async (entry) => {
          outcomes.push(entry.outcome)
        },
      }),
    )({ code: 'await cua.getState()' })

    expect(result.isError).toBe(true)
    expect(outcomes).toEqual(['device_offline'])
  })
})
