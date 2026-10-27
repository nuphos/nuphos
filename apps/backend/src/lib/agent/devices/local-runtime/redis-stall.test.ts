import { describe, expect, test } from 'bun:test'

import { useRedis } from '@/lib/test/doubles/redis'

import { attachRuntimeTunnel } from './holder'
import { createRedisPresenceStore } from './presence'

import type { TunnelBus } from './bus'
import type { BackendFrame } from './protocol'

// Just enough of ioredis for the presence scripts: claim, put and clear by conn.
class FakeRedis {
  value: string | undefined

  async eval(script: string, _keys: number, _key: string, ...args: string[]) {
    const held = this.value ? (JSON.parse(this.value) as { conn: string }).conn : undefined

    if (script.includes('return old')) {
      const old = this.value ?? ''

      this.value = args[0]

      return old
    }
    if (script.includes('SET')) {
      if (held !== args[0]) return 0
      this.value = args[1]

      return 1
    }
    if (held === args[0]) this.value = undefined

    return 0
  }
}

const redis = new FakeRedis()
let stalled = false

useRedis({
  redisEnabled: () => true,
  // A stalled Redis times out every op, which withRedis reports as null.
  withRedis: async (op) => (stalled ? null : op(redis as never)),
})

const tick = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

describe('local runtime tunnel during a Redis stall', () => {
  test('keeps pinging the computer and keeps its tunnel open', async () => {
    stalled = false
    // Pub/sub that never delivers once Redis stalls.
    const bus: TunnelBus = {
      publish: () => (stalled ? new Promise(() => {}) : Promise.resolve()),
      subscribe: () => Promise.resolve(() => {}),
    }
    const frames: BackendFrame[] = []
    let closed: { code: number; reason: string } | undefined
    const tunnel = await attachRuntimeTunnel(
      'u1',
      'd1',
      {
        send: (frame) => {
          frames.push(frame)
          // The computer answers every ping, as the desktop does.
          if (frame.t === 'ping') tunnel.receive(JSON.stringify({ t: 'pong' }))
        },
        close: (code, reason) => {
          closed = { code, reason }
        },
      },
      {
        bus,
        presence: createRedisPresenceStore(),
        isMember: async () => true,
        heartbeatMs: 10,
        idleTimeoutMs: 40,
      },
    )

    try {
      stalled = true
      const before = frames.filter((frame) => frame.t === 'ping').length

      await tick(150)
      expect(frames.filter((frame) => frame.t === 'ping').length).toBeGreaterThan(before + 5)
      expect(closed).toBeUndefined()
    } finally {
      stalled = false
      tunnel.closed()
    }
  })

  test('still ends the tunnel once Redis says another connection holds the computer', async () => {
    stalled = false
    let closed: { code: number; reason: string } | undefined
    const presence = createRedisPresenceStore()
    const tunnel = await attachRuntimeTunnel(
      'u1',
      'd1',
      {
        send: () => {},
        close: (code, reason) => {
          closed = { code, reason }
        },
      },
      {
        bus: { publish: () => Promise.resolve(), subscribe: () => Promise.resolve(() => {}) },
        presence,
        isMember: async () => true,
        heartbeatMs: 60_000,
      },
    )

    try {
      await presence.claim('u1', 'd1', 'someone-else')
      tunnel.receive(JSON.stringify({ t: 'pong' }))
      await tick(10)
      expect(closed?.reason).toBe('Device presence expired')
    } finally {
      tunnel.closed()
    }
  })

  test('ends the tunnel when its subscription stops delivering, so streams are not lost', async () => {
    stalled = false
    let reconnects = 0
    let closed: { code: number; reason: string } | undefined
    const tunnel = await attachRuntimeTunnel(
      'u1',
      'd1',
      {
        // The computer itself is fine and answers every direct ping.
        send: (frame) => {
          if (frame.t === 'ping') tunnel.receive(JSON.stringify({ t: 'pong' }))
        },
        close: (code, reason) => {
          closed = { code, reason }
        },
      },
      {
        // Publishes succeed, but a half-open subscriber delivers nothing back.
        bus: {
          publish: () => Promise.resolve(),
          subscribe: () => Promise.resolve(() => {}),
          reconnect: () => {
            reconnects += 1
          },
        },
        presence: createRedisPresenceStore(),
        isMember: async () => true,
        heartbeatMs: 10,
        idleTimeoutMs: 40,
        channelTimeoutMs: 80,
      },
    )

    try {
      await tick(40)
      expect(closed).toBeUndefined()
      await tick(120)
      expect(closed).toEqual({ code: 4001, reason: 'Device channel unavailable' })
      // The next tunnel must not subscribe on the same dead connection.
      expect(reconnects).toBe(1)
    } finally {
      tunnel.closed()
    }
  })
})
