import { afterEach, describe, expect, test } from 'bun:test'

import { localRuntimeUrl } from './address'
import { createLocalTunnelBus } from './bus'
import { attachRuntimeTunnel, TUNNEL_CLOSE_SUPERSEDED } from './holder'
import { createMemoryPresenceStore } from './presence'
import { processSingleton } from './singleton'
import { openLocalRuntimeSocket } from './socket'

import type { TunnelBus } from './bus'
import type { RuntimeTunnel } from './holder'
import type { LocalRuntimePresenceStore } from './presence'
import type { BackendFrame } from './protocol'

const owner = { userId: 'u1', deviceId: 'd1', provider: 'claude-code' as const }
const tick = () => new Promise((resolve) => setTimeout(resolve, 5))

async function eventually(check: () => boolean): Promise<void> {
  for (let i = 0; i < 100 && !check(); i++) await tick()
  expect(check()).toBe(true)
}

type Desktop = {
  frames: BackendFrame[]
  closed?: { code: number; reason: string }
  tunnel: RuntimeTunnel
  send(frame: object): void
}

const tunnels: RuntimeTunnel[] = []

afterEach(() => {
  for (const tunnel of tunnels.splice(0)) tunnel.closed()
})

/** One replica holding the desktop's WebSocket; `echo` plays the runtime behind it. */
async function connectDesktop(
  bus: TunnelBus,
  presence: LocalRuntimePresenceStore,
  teams: Set<string>,
  options: {
    echo?: boolean
    heartbeatMs?: number
    idleTimeoutMs?: number
  } = {},
): Promise<Desktop> {
  const desktop = { frames: [] as BackendFrame[] } as Desktop

  desktop.tunnel = await attachRuntimeTunnel(
    owner.userId,
    owner.deviceId,
    {
      send: (frame) => {
        desktop.frames.push(frame)
        if (!options.echo) return
        if (frame.t === 'open') desktop.send({ t: 'opened', s: frame.s })
        if (frame.t === 'data') desktop.send({ t: 'data', s: frame.s, d: `echo:${frame.d}` })
      },
      close: (code, reason) => {
        desktop.closed = { code, reason }
      },
    },
    {
      bus,
      presence,
      isMember: async (_u, teamId) => teams.has(teamId),
      heartbeatMs: options.heartbeatMs ?? 60_000,
      ...(options.idleTimeoutMs ? { idleTimeoutMs: options.idleTimeoutMs } : {}),
    },
  )
  desktop.send = (frame) => {
    desktop.tunnel.receive(JSON.stringify(frame))
  }
  tunnels.push(desktop.tunnel)
  desktop.send({
    t: 'status',
    status: { agents: { 'claude-code': { cli: { installed: true, loggedIn: true } } } },
  })
  desktop.send({ t: 'pong' })
  await tick()

  return desktop
}

function openStream(bus: TunnelBus, presence: LocalRuntimePresenceStore, teamId: string) {
  const socket = openLocalRuntimeSocket(
    localRuntimeUrl(owner, teamId),
    ['openab.bearer.transport', 'acp.v1'],
    { bus, presence, livenessMs: 60_000 },
  )
  const events: { type: string; data?: unknown; reason?: string }[] = []

  for (const type of ['open', 'message', 'close'])
    socket.addEventListener(type, (event) => {
      events.push({ type, data: event.data, reason: event.reason })
    })

  return { socket, events }
}

describe('local runtime tunnel', () => {
  test('a stream opened on another replica reaches the computer and back', async () => {
    const bus = createLocalTunnelBus()
    const presence = createMemoryPresenceStore()

    await connectDesktop(bus, presence, new Set(['t1']), { echo: true })
    const { socket, events } = openStream(bus, presence, 't1')

    await eventually(() => events.some((event) => event.type === 'open'))
    socket.send('{"jsonrpc":"2.0"}')
    await eventually(() => events.some((event) => event.type === 'message'))

    expect(events.find((event) => event.type === 'message')?.data).toBe('echo:{"jsonrpc":"2.0"}')
  })

  test('a team its owner is not in is refused by the holder', async () => {
    const bus = createLocalTunnelBus()
    const presence = createMemoryPresenceStore()
    const desktop = await connectDesktop(bus, presence, new Set(['t1']), { echo: true })
    const { events } = openStream(bus, presence, 't2')

    await eventually(() => events.some((event) => event.type === 'close'))

    expect(events.map((event) => event.type)).toEqual(['close'])
    expect(desktop.frames.filter((frame) => frame.t === 'open')).toEqual([])
  })

  test('an offline computer fails the connection instead of hanging', async () => {
    const { events } = openStream(createLocalTunnelBus(), createMemoryPresenceStore(), 't1')

    await eventually(() => events.some((event) => event.type === 'close'))

    expect(events[0]?.reason).toContain('offline')
  })

  test('the computer disconnecting closes every stream it carried', async () => {
    const bus = createLocalTunnelBus()
    const presence = createMemoryPresenceStore()
    const desktop = await connectDesktop(bus, presence, new Set(['t1']), { echo: true })
    const { events } = openStream(bus, presence, 't1')

    await eventually(() => events.some((event) => event.type === 'open'))
    desktop.tunnel.closed()
    await eventually(() => events.some((event) => event.type === 'close'))

    expect(await presence.get(owner.userId, owner.deviceId)).toBeNull()
  })

  test('a newer connection from the same computer supersedes the old one', async () => {
    const bus = createLocalTunnelBus()
    const presence = createMemoryPresenceStore()
    const first = await connectDesktop(bus, presence, new Set(['t1']), { echo: true })
    const second = await connectDesktop(bus, presence, new Set(['t1']), { echo: true })

    expect(first.closed?.code).toBe(TUNNEL_CLOSE_SUPERSEDED)
    const { events } = openStream(bus, presence, 't1')

    await eventually(() => events.some((event) => event.type === 'open'))
    expect(second.frames.some((frame) => frame.t === 'open')).toBe(true)
    expect(first.frames.some((frame) => frame.t === 'open')).toBe(false)
  })

  test('closing the backend side tells the computer to drop the stream', async () => {
    const bus = createLocalTunnelBus()
    const presence = createMemoryPresenceStore()
    const desktop = await connectDesktop(bus, presence, new Set(['t1']), { echo: true })
    const { socket, events } = openStream(bus, presence, 't1')

    await eventually(() => events.some((event) => event.type === 'open'))
    socket.close()
    await eventually(() => desktop.frames.some((frame) => frame.t === 'close'))
  })

  test('a computer that stops answering pings is dropped and goes offline', async () => {
    const bus = createLocalTunnelBus()
    const presence = createMemoryPresenceStore()
    const desktop = await connectDesktop(bus, presence, new Set(['t1']), {
      heartbeatMs: 10,
      idleTimeoutMs: 40,
    })

    expect(await presence.get(owner.userId, owner.deviceId)).not.toBeNull()
    await eventually(() => desktop.closed !== undefined)

    expect(await presence.get(owner.userId, owner.deviceId)).toBeNull()
  })

  test('presence lives only as long as the socket keeps answering', async () => {
    let clock = 0
    const presence = createMemoryPresenceStore(() => clock)
    const desktop = await connectDesktop(createLocalTunnelBus(), presence, new Set(['t1']))

    clock += 10_000
    desktop.send({ t: 'pong' })
    await tick()
    clock += 10_000
    expect(await presence.get(owner.userId, owner.deviceId)).not.toBeNull()
    clock += 30_000
    expect(await presence.get(owner.userId, owner.deviceId)).toBeNull()
  })

  test('the bus and presence registry survive a module reload', () => {
    const first = processSingleton('test-registry', () => ({}))

    expect(processSingleton('test-registry', () => ({}))).toBe(first)
  })
})

test('a socket and status alone do not advertise presence before the first pong', async () => {
  const presence = createMemoryPresenceStore()
  const tunnel = await attachRuntimeTunnel(
    'u1',
    'd1',
    { send: () => {}, close: () => {} },
    {
      bus: createLocalTunnelBus(),
      presence,
      isMember: async () => true,
    },
  )

  tunnels.push(tunnel)
  tunnel.receive(JSON.stringify({ t: 'status', status: { agents: {}, localExec: true } }))
  expect(await presence.get('u1', 'd1')).toBeNull()
  tunnel.receive(JSON.stringify({ t: 'pong' }))
  await tick()
  expect((await presence.get('u1', 'd1'))?.status?.localExec).toBe(true)
})

test('a late heartbeat or cleanup from the old holder cannot replace the new lease', async () => {
  const presence = createMemoryPresenceStore()

  await presence.claim('u1', 'd1', 'old')
  await presence.put('u1', 'd1', { conn: 'old', seenAt: Date.now() })
  expect(await presence.claim('u1', 'd1', 'new')).toBe('old')
  expect(await presence.put('u1', 'd1', { conn: 'old', seenAt: Date.now() })).toBe(false)
  await presence.put('u1', 'd1', { conn: 'new', seenAt: Date.now() })
  await presence.clear('u1', 'd1', 'old')
  expect((await presence.get('u1', 'd1'))?.conn).toBe('new')
})

test('losing the command bus also loses heartbeat and takes the device offline', async () => {
  const bus = createLocalTunnelBus()
  let broken = false
  const brokenBus: TunnelBus = {
    ...bus,
    publish: (channel, message) => (broken ? Promise.resolve() : bus.publish(channel, message)),
  }
  const presence = createMemoryPresenceStore()
  const desktop = await connectDesktop(brokenBus, presence, new Set(['t1']), {
    heartbeatMs: 5,
    idleTimeoutMs: 20,
  })

  broken = true
  // Status reports must not keep a broken dispatch path advertised as online.
  desktop.send({ t: 'status', status: { agents: {}, localExec: true } })
  await eventually(() => desktop.closed !== undefined)
  expect(await presence.get(owner.userId, owner.deviceId)).toBeNull()
})
