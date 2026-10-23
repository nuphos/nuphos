import assert from 'node:assert/strict'
import { test } from 'node:test'

import { RuntimeTunnelClient } from './tunnel-client.ts'

import type { SocketEvent, SocketLike } from './tunnel-client.ts'

class Socket implements SocketLike {
  readyState = 1
  sent: Record<string, unknown>[] = []
  listeners = new Map<string, (event: SocketEvent) => void>()
  send(raw: string) {
    this.sent.push(JSON.parse(raw) as Record<string, unknown>)
  }
  close() {
    this.readyState = 3
  }
  addEventListener(type: string, listener: (event: SocketEvent) => void) {
    this.listeners.set(type, listener)
  }
  emit(frame: object) {
    this.listeners.get('message')?.({ data: JSON.stringify(frame) })
  }
}

const sample = {
  sampledAt: new Date().toISOString(),
  cpuPercent: 25,
  memory: { used: 1, total: 2 },
  disk: { used: 1, total: 3 },
}
const flush = () => new Promise((resolve) => setImmediate(resolve))

function setup(sampleMetrics: () => Promise<typeof sample | null>) {
  const socket = new Socket()
  const client = new RuntimeTunnelClient({
    connectBackend: () => socket,
    connectRuntime: () => null,
    sampleMetrics,
    status: () => ({ agents: {} }),
  })

  client.start()
  socket.listeners.get('open')?.({})

  return { socket, client }
}

test('reports on connect and every 5 seconds after the last sample; stop ends it', async (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1_000_000 })
  let count = 0
  const { socket, client } = setup(() => {
    count += 1

    return Promise.resolve(sample)
  })

  try {
    assert.ok(
      socket.sent.some(
        (frame) =>
          frame.t === 'status' && (frame.status as { localMetrics?: boolean }).localMetrics,
      ),
    )
    await flush()
    assert.equal(count, 1)
    assert.equal(socket.sent.filter((frame) => frame.t === 'metrics').length, 1)
    // An older backend's lease is ignored; it neither adds nor delays samples.
    socket.emit({ t: 'metrics', leaseMs: 12_000 })
    await flush()
    assert.equal(count, 1)
    t.mock.timers.tick(4_999)
    await flush()
    assert.equal(count, 1)
    t.mock.timers.tick(1)
    await flush()
    assert.equal(count, 2)
    client.stop()
    t.mock.timers.tick(5_000)
    await flush()
    assert.equal(count, 2)
    assert.equal(socket.sent.filter((frame) => frame.t === 'metrics').length, 2)
  } finally {
    client.stop()
  }
})

test('a slow or failed sample never overlaps and is retried 5 seconds later', async (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1_000_000 })
  let finish!: (result: typeof sample | null) => void
  let count = 0
  const { socket, client } = setup(() => {
    count += 1
    if (count === 2) return Promise.reject(new Error('probe failed'))

    return new Promise((resolve) => {
      finish = resolve
    })
  })

  try {
    t.mock.timers.tick(10_000)
    assert.equal(count, 1)
    // Keeps the tunnel's idle timeout from dropping the connection mid-test.
    socket.emit({ t: 'ping' })
    finish(null)
    await flush()
    t.mock.timers.tick(5_000)
    await flush()
    assert.equal(count, 2)
    socket.emit({ t: 'ping' })
    t.mock.timers.tick(5_000)
    await flush()
    assert.equal(count, 3)
    client.stop()
    finish(sample)
    await flush()
    assert.equal(socket.sent.filter((frame) => frame.t === 'metrics').length, 0)
  } finally {
    client.stop()
  }
})
