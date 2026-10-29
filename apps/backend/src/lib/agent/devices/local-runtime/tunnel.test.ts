import { afterEach, describe, expect, spyOn, test } from 'bun:test'

import { localRuntimeUrl } from './address'
import { createLocalTunnelBus } from './bus'
import { holderChannel } from './protocol'
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

/** The structured log lines a block wrote at `level`, parsed. */
async function logged(level: 'log' | 'warn', run: () => Promise<void>) {
  const spy = spyOn(console, level).mockImplementation(() => {})

  try {
    await run()

    return spy.mock.calls.map(([line]) => JSON.parse(String(line)) as Record<string, unknown>)
  } finally {
    spy.mockRestore()
  }
}

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
    /** Active members by team; any user when absent. */
    members?: Map<string, Set<string>>
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
      isMember: async (u, teamId) =>
        teams.has(teamId) && (options.members?.get(teamId)?.has(u) ?? true),
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

function openStream(
  bus: TunnelBus,
  presence: LocalRuntimePresenceStore,
  teamId: string,
  actorId = owner.userId,
) {
  const socket = openLocalRuntimeSocket(
    localRuntimeUrl(owner, teamId, actorId),
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

  test('the actor’s membership decides, not the transport owner’s', async () => {
    const bus = createLocalTunnelBus()
    const presence = createMemoryPresenceStore()
    // The owner (who ordered the Box) left the team; a member still in it may open a stream.
    const members = new Map([['t1', new Set(['alice'])]])

    await connectDesktop(bus, presence, new Set(['t1']), { echo: true, members })
    const alice = openStream(bus, presence, 't1', 'alice')
    const gone = openStream(bus, presence, 't1', owner.userId)

    await eventually(() => alice.events.some((event) => event.type === 'open'))
    await eventually(() => gone.events.some((event) => event.type === 'close'))
    expect(gone.events.map((event) => event.type)).toEqual(['close'])
  })

  test('revoking one person closes only their streams; the tunnel and others stay', async () => {
    const bus = createLocalTunnelBus()
    const presence = createMemoryPresenceStore()
    const desktop = await connectDesktop(bus, presence, new Set(['t1']), { echo: true })
    const alice = openStream(bus, presence, 't1', 'alice')
    const bob = openStream(bus, presence, 't1', 'bob')

    await eventually(() => alice.events.some((event) => event.type === 'open'))
    await eventually(() => bob.events.some((event) => event.type === 'open'))
    await bus.publish(
      holderChannel(owner.userId, owner.deviceId),
      JSON.stringify({ t: 'revoke-actor', actorId: 'alice' }),
    )
    await eventually(() => alice.events.some((event) => event.type === 'close'))
    // Later input from the revoked stream never reaches the computer.
    const before = desktop.frames.length

    alice.socket.close()
    bob.socket.send('still here')
    await eventually(() => bob.events.some((event) => event.type === 'message'))

    expect(alice.events.find((event) => event.type === 'close')?.reason).toContain('removed')
    expect(desktop.frames.slice(before).filter((frame) => frame.t === 'data')).toHaveLength(1)
    expect(desktop.closed).toBeUndefined()
    expect(bob.events.some((event) => event.type === 'close')).toBe(false)
  })

  test('revoking someone in one team leaves their streams in another team open', async () => {
    const bus = createLocalTunnelBus()
    const presence = createMemoryPresenceStore()

    await connectDesktop(bus, presence, new Set(['t1', 't2']), { echo: true })
    const inT1 = openStream(bus, presence, 't1', 'alice')
    const inT2 = openStream(bus, presence, 't2', 'alice')

    await eventually(() => inT1.events.some((event) => event.type === 'open'))
    await eventually(() => inT2.events.some((event) => event.type === 'open'))
    await bus.publish(
      holderChannel(owner.userId, owner.deviceId),
      JSON.stringify({ t: 'revoke-actor', actorId: 'alice', teamId: 't1' }),
    )
    await eventually(() => inT1.events.some((event) => event.type === 'close'))
    inT2.socket.send('still here')
    await eventually(() => inT2.events.some((event) => event.type === 'message'))

    expect(inT2.events.some((event) => event.type === 'close')).toBe(false)
  })

  test('an offline computer fails the connection instead of hanging, and says why', async () => {
    let events: { type: string; reason?: string }[] = []
    const lines = await logged('warn', async () => {
      events = openStream(createLocalTunnelBus(), createMemoryPresenceStore(), 't1').events
      await eventually(() => events.some((event) => event.type === 'close'))
    })

    expect(events[0]?.reason).toContain('offline')
    expect(lines).toContainEqual(
      expect.objectContaining({
        event: 'agent.local_runtime.stream_failed',
        stage: 'connect',
        cause: 'no_presence',
      }),
    )
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
    const lines = await logged('log', () => eventually(() => desktop.closed !== undefined))

    expect(await presence.get(owner.userId, owner.deviceId)).toBeNull()
    // The backend closed it, so the reason is logged here or nowhere.
    expect(lines).toContainEqual(
      expect.objectContaining({
        event: 'agent.local_runtime.tunnel_closed',
        code: 4001,
        reason: 'No frames from the computer',
      }),
    )
  })

  test('the computer reports why it gave up its last tunnel', async () => {
    const desktop = await connectDesktop(
      createLocalTunnelBus(),
      createMemoryPresenceStore(),
      new Set(['t1']),
    )
    const lines = await logged('log', async () => {
      desktop.send({ t: 'dropped', reason: 'idle', silentMs: 12_004 })
      await tick()
    })

    expect(lines).toContainEqual(
      expect.objectContaining({
        event: 'agent.local_runtime.tunnel_closed',
        closed_by: 'desktop',
        reason: 'idle',
        silent_ms: 12_004,
      }),
    )
  })

  test('a backlog of data without pongs keeps the tunnel open and present', async () => {
    const bus = createLocalTunnelBus()
    const presence = createMemoryPresenceStore()
    const desktop = await connectDesktop(bus, presence, new Set(['t1']), {
      heartbeatMs: 10,
      idleTimeoutMs: 40,
    })
    const until = Date.now() + 150

    // A busy tunnel: data keeps flowing and the pongs sit behind it.
    while (Date.now() < until) {
      desktop.send({ t: 'data', s: 'busy', d: 'x'.repeat(1024) })
      await tick()
    }
    expect(desktop.closed).toBeUndefined()
    expect(await presence.get(owner.userId, owner.deviceId)).not.toBeNull()
  })

  test('presence lives only as long as the computer keeps sending', async () => {
    let clock = 0
    const presence = createMemoryPresenceStore(() => clock)
    const desktop = await connectDesktop(createLocalTunnelBus(), presence, new Set(['t1']), {
      heartbeatMs: 1,
    })

    clock += 10_000
    await tick()
    desktop.send({ t: 'data', s: 'busy', d: 'x' })
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

test('the first frame advertises presence with the status it carries', async () => {
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
  expect(await presence.get('u1', 'd1')).toBeNull()
  tunnel.receive(JSON.stringify({ t: 'status', status: { agents: {}, localExec: true } }))
  await tick()
  expect((await presence.get('u1', 'd1'))?.status?.localExec).toBe(true)
})

test('a model catalog over its bounds costs the catalog, never the presence', async () => {
  const presence = createMemoryPresenceStore()
  const tunnel = await attachRuntimeTunnel(
    'u1',
    'd1',
    { send: () => {}, close: () => {} },
    { bus: createLocalTunnelBus(), presence, isMember: async () => true },
  )
  const models = Array.from({ length: 201 }, (_, i) => ({ id: `m${i}`, name: `M${i}` }))

  tunnels.push(tunnel)
  tunnel.receive(
    JSON.stringify({
      t: 'status',
      status: {
        localExec: true,
        agents: {
          opencode: {
            cli: { installed: true, loggedIn: true },
            models: { models, defaultModel: 'm0', controls: {} },
          },
        },
      },
    }),
  )
  tunnel.receive(JSON.stringify({ t: 'pong' }))
  await tick()
  const status = (await presence.get('u1', 'd1'))?.status

  expect(status?.localExec).toBe(true)
  expect(status?.agents.opencode?.cli.loggedIn).toBe(true)
  expect(status?.agents.opencode?.models).toBeUndefined()
})

test('a rejected frame is logged with its failing paths only', async () => {
  const log = spyOn(console, 'warn').mockImplementation(() => {})
  const tunnel = await attachRuntimeTunnel(
    'u1',
    'd1',
    { send: () => {}, close: () => {} },
    {
      bus: createLocalTunnelBus(),
      presence: createMemoryPresenceStore(),
      isMember: async () => true,
    },
  )

  tunnels.push(tunnel)
  tunnel.receive(
    JSON.stringify({ t: 'status', status: { agents: {}, cliVersion: 'x'.repeat(51) } }),
  )
  const lines = log.mock.calls.map((call) => String(call[0]))

  log.mockRestore()
  const line = lines.find((l) => l.includes('agent.local_runtime.frame_rejected'))

  expect(line).toContain('status.cliVersion')
  expect(line).not.toContain('xxxxx')
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

test('a status report records the signed-in agents once, not on every repeat', async () => {
  const records: unknown[] = []
  const tunnel = await attachRuntimeTunnel(
    'u1',
    'd1',
    { send() {}, close() {} },
    {
      bus: createLocalTunnelBus(),
      presence: createMemoryPresenceStore(),
      isMember: async () => true,
      recordAgents: async (userId, deviceId, status) => {
        records.push([userId, deviceId, Object.keys(status.agents)])
      },
    },
  )

  tunnels.push(tunnel)
  const report = (loggedIn: boolean) =>
    tunnel.receive(
      JSON.stringify({
        t: 'status',
        status: { agents: { 'claude-code': { cli: { installed: true, loggedIn } } } },
      }),
    )

  report(true)
  report(true)
  report(false)
  await eventually(() => records.length === 2)
  expect(records).toEqual([
    ['u1', 'd1', ['claude-code']],
    ['u1', 'd1', ['claude-code']],
  ])
})

test('every usage report is handed to the recorder with its device', async () => {
  const records: [string, string, number][] = []
  const tunnel = await attachRuntimeTunnel(
    'u1',
    'd1',
    { send() {}, close() {} },
    {
      bus: createLocalTunnelBus(),
      presence: createMemoryPresenceStore(),
      isMember: async () => true,
      recordMetrics: (userId, deviceId, metrics) => {
        records.push([userId, deviceId, metrics.cpuPercent])
      },
    },
  )

  tunnels.push(tunnel)
  for (const cpuPercent of [10, 20])
    tunnel.receive(
      JSON.stringify({
        t: 'metrics',
        metrics: {
          sampledAt: '2026-10-26T03:40:01.000Z',
          cpuPercent,
          memory: { used: 6e9, total: 8e9 },
          disk: { used: 1e10, total: 1.6e10 },
        },
      }),
    )
  expect(records).toEqual([
    ['u1', 'd1', 10],
    ['u1', 'd1', 20],
  ])
})
