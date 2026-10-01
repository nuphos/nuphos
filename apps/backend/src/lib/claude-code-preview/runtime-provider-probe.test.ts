import { describe, expect, test } from 'bun:test'

import { probeExternalRuntimeProvider } from './runtime-provider-probe'

class FakeSocket {
  static readonly OPEN = 1
  readonly sent: string[] = []
  readyState = 0
  closeCalls = 0
  readonly listeners = new Map<string, ((event: Record<string, unknown>) => void)[]>()

  constructor(
    readonly url: string,
    readonly protocols: string[],
  ) {
    queueMicrotask(() => {
      this.readyState = FakeSocket.OPEN
      this.emit('open', {})
    })
  }

  addEventListener(type: string, listener: (event: Record<string, unknown>) => void) {
    const current = this.listeners.get(type) ?? []

    current.push(listener)
    this.listeners.set(type, current)
  }

  removeEventListener(type: string, listener: (event: Record<string, unknown>) => void) {
    this.listeners.set(
      type,
      (this.listeners.get(type) ?? []).filter((candidate) => candidate !== listener),
    )
  }

  send(data: string) {
    this.sent.push(data)
  }

  close() {
    this.closeCalls++
    this.emit('close', {})
  }

  receive(value: unknown) {
    this.emit('message', { data: JSON.stringify(value) })
  }

  private emit(type: string, event: Record<string, unknown>) {
    for (const listener of this.listeners.get(type) ?? []) listener(event)
  }
}

function harness() {
  let socket: FakeSocket | undefined
  const connect = (url: string, protocols: string[]) => {
    socket = new FakeSocket(url, protocols)

    return socket
  }

  return {
    connect,
    socket: () => {
      if (!socket) throw new Error('socket was not created')

      return socket
    },
  }
}

async function nextSent(socket: FakeSocket, index: number) {
  for (let attempt = 0; attempt < 10 && socket.sent.length <= index; attempt++) {
    await Bun.sleep(0)
  }

  return JSON.parse(socket.sent[index]!) as { id: number }
}

function unreachableSocket(): never {
  throw new Error('connection refused')
}

function initializeResultWith(adapterVersion: string | undefined) {
  return {
    agentCapabilities: {
      _meta: { ...(adapterVersion ? { 'dev.openab/adapterVersion': adapterVersion } : {}) },
    },
  }
}

describe('probeExternalRuntimeProvider', () => {
  test('recognizes the Claude Code adapter stamp', async () => {
    const h = harness()
    const probing = probeExternalRuntimeProvider('wss://openab.example/acp', 'password', h.connect)
    const frame = await nextSent(h.socket(), 0)

    h.socket().receive({
      jsonrpc: '2.0',
      id: frame.id,
      result: initializeResultWith('claude-agent-acp@0.74.0'),
    })

    await expect(probing).resolves.toBe('claude-code')
    expect(h.socket().closeCalls).toBe(1)
  })

  test('recognizes the Codex adapter stamp', async () => {
    const h = harness()
    const probing = probeExternalRuntimeProvider('wss://openab.example/acp', 'password', h.connect)
    const frame = await nextSent(h.socket(), 0)

    h.socket().receive({
      jsonrpc: '2.0',
      id: frame.id,
      result: initializeResultWith('codex-acp@0.153.4'),
    })

    await expect(probing).resolves.toBe('codex')
  })

  test('falls back to undefined when the runtime reports no build stamp', async () => {
    const h = harness()
    const probing = probeExternalRuntimeProvider('wss://openab.example/acp', 'password', h.connect)
    const frame = await nextSent(h.socket(), 0)

    h.socket().receive({ jsonrpc: '2.0', id: frame.id, result: initializeResultWith(undefined) })

    await expect(probing).resolves.toBeUndefined()
  })

  test('falls back to undefined when the runtime is unreachable', async () => {
    await expect(
      probeExternalRuntimeProvider('wss://openab.example/acp', 'password', unreachableSocket),
    ).resolves.toBeUndefined()
  })
})
