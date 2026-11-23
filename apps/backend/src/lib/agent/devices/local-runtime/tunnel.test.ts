import { afterEach, describe, expect, spyOn, test } from 'bun:test'

import { localRuntimeUrl } from './address'
import { createLocalTunnelBus, guardedReconnect } from './bus'
import { holderChannel, streamChannel } from './protocol'
import {
  attachRuntimeTunnel,
  closeTunnelsForRestart,
  connectedComputerCount,
  TUNNEL_CLOSE_SUPERSEDED,
} from './holder'
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
    /** Connected but has not sent its first frame yet. */
    silent?: boolean
    recordAgents?: () => Promise<void>
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
      ...(options.recordAgents ? { recordAgents: options.recordAgents } : {}),
    },
  )
  desktop.send = (frame) => {
    desktop.tunnel.receive(JSON.stringify(frame))
  }
  tunnels.push(desktop.tunnel)
  if (options.silent) return desktop
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
  purpose = 'transport',
) {
  const socket = openLocalRuntimeSocket(
    localRuntimeUrl(owner, teamId, actorId),
    [`openab.bearer.${purpose}`, 'acp.v1'],
    { bus, presence, livenessMs: 60_000, closeRetryMs: 5 },
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
        team_id: 't1',
        stage: 'connect',
        cause: 'no_presence',
      }),
    )
  })

  test('a dropped tunnel logs the teams whose streams it was carrying', async () => {
    const bus = createLocalTunnelBus()
    const presence = createMemoryPresenceStore()
    const desktop = await connectDesktop(bus, presence, new Set(['t1', 't2']), { echo: true })

    for (const teamId of ['t1', 't2', 't1']) {
      const { events } = openStream(bus, presence, teamId)

      await eventually(() => events.some((event) => event.type === 'open'))
    }
    const lines = await logged('log', async () => desktop.tunnel.closed(1006, ''))

    expect(lines).toContainEqual(
      expect.objectContaining({ event: 'agent.local_runtime.tunnel_closed', team_ids: 't1,t2' }),
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

  test('a computer redialing keeps its old tunnel serving until the new one speaks', async () => {
    const bus = createLocalTunnelBus()
    const presence = createMemoryPresenceStore()
    const first = await connectDesktop(bus, presence, new Set(['t1']), { echo: true })
    const second = await connectDesktop(bus, presence, new Set(['t1']), {
      echo: true,
      silent: true,
    })

    // The new tunnel has said nothing yet, so a stream opened now still runs on the old one.
    expect(first.closed).toBeUndefined()
    const during = openStream(bus, presence, 't1')

    await eventually(() => during.events.some((event) => event.type === 'open'))
    during.socket.send('hi')
    await eventually(() => during.events.some((event) => event.data === 'echo:hi'))
    expect(first.frames.some((frame) => frame.t === 'open')).toBe(true)
    expect(second.frames.some((frame) => frame.t === 'open')).toBe(false)

    // Its first frame hands the computer over, and the next stream finds it right away.
    second.send({
      t: 'status',
      status: { agents: { 'claude-code': { cli: { installed: true, loggedIn: true } } } },
    })
    await eventually(() => first.closed?.code === TUNNEL_CLOSE_SUPERSEDED)
    const after = openStream(bus, presence, 't1')

    await eventually(() => after.events.some((event) => event.type === 'open'))
    expect(after.events.some((event) => event.type === 'close')).toBe(false)
  })

  test('a second tunnel from the same computer leaves the first one’s streams alone', async () => {
    const bus = createLocalTunnelBus()
    const presence = createMemoryPresenceStore()

    await connectDesktop(bus, presence, new Set(['t1']), { echo: true })
    await connectDesktop(bus, presence, new Set(['t1']), { echo: true, silent: true })
    const { socket, events } = openStream(bus, presence, 't1')

    await eventually(() => events.some((event) => event.type === 'open'))
    socket.send('hi')
    socket.send('again')
    await eventually(() => events.some((event) => event.data === 'echo:again'))
    await tick()

    expect(events.some((event) => event.type === 'close')).toBe(false)
  })

  test('an agent being added shows in presence as soon as it installs, not at the next heartbeat', async () => {
    const presence = createMemoryPresenceStore()
    const desktop = await connectDesktop(createLocalTunnelBus(), presence, new Set(['t1']), {
      recordAgents: async () => {},
    })
    const instanceId = '62c4cdb9-b7a0-49a4-8438-6eff3e2f60d9'

    // The heartbeat is a minute away: only the status report itself can write this.
    desktop.send({
      t: 'status',
      status: {
        agents: { 'claude-code': { cli: { installed: true, loggedIn: true } } },
        instances: [
          {
            instanceId,
            provider: 'claude-code',
            label: 'Claude Code',
            state: 'pending',
            cli: { installed: false, loggedIn: false, installing: true },
          },
        ],
      },
    })
    const installing = async () =>
      (await presence.get(owner.userId, owner.deviceId))?.status?.instances?.[0]?.cli.installing

    for (let i = 0; i < 100 && (await installing()) !== true; i++) await tick()
    expect(await installing()).toBe(true)
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

  // #3648: the network reset the computer's socket, so the old tunnel no longer reaches it.
  test('a stream the computer had not opened moves to the tunnel that took it over', async () => {
    const bus = createLocalTunnelBus()
    const presence = createMemoryPresenceStore()
    const first = await connectDesktop(bus, presence, new Set(['t1']))
    const { events } = openStream(bus, presence, 't1')

    await eventually(() => first.frames.some((frame) => frame.t === 'open'))
    const second = await connectDesktop(bus, presence, new Set(['t1']), { echo: true })

    await eventually(() => events.some((event) => event.type === 'open'))
    expect(first.closed?.code).toBe(TUNNEL_CLOSE_SUPERSEDED)
    expect(second.frames.some((frame) => frame.t === 'open')).toBe(true)
    expect(events.some((event) => event.type === 'close')).toBe(false)
  })

  test('a stream sent to a tunnel already gone opens on its replacement at the next check', async () => {
    const bus = createLocalTunnelBus()
    const presence = createMemoryPresenceStore()

    // Presence still names a tunnel whose holder is gone, as in the moment after it ended.
    await presence.claim(owner.userId, owner.deviceId, 'gone', { conn: 'gone', seenAt: Date.now() })
    const socket = openLocalRuntimeSocket(
      localRuntimeUrl(owner, 't1'),
      ['openab.bearer.transport', 'acp.v1'],
      { bus, presence, livenessMs: 10, closeRetryMs: 5 },
    )
    const lines = await logged('warn', async () => {
      await tick()
      await connectDesktop(bus, presence, new Set(['t1']), { echo: true })
      await eventually(() => socket.readyState === 1)
    })

    expect(lines.filter((line) => line.event === 'agent.local_runtime.stream_failed')).toEqual([])
    socket.close()
  })

  test('a stream the computer had not opened ends at once when its tunnel ends for good', async () => {
    const bus = createLocalTunnelBus()
    const presence = createMemoryPresenceStore()
    const desktop = await connectDesktop(bus, presence, new Set(['t1']))
    const { events } = openStream(bus, presence, 't1')

    await eventually(() => desktop.frames.some((frame) => frame.t === 'open'))
    desktop.tunnel.closed()
    await eventually(() => events.some((event) => event.type === 'close'))
    expect(events[0]?.reason).toContain('disconnected')
  })

  test('counts each held computer once, however its tunnel ends', async () => {
    const bus = createLocalTunnelBus()
    const presence = createMemoryPresenceStore()
    const before = connectedComputerCount()
    const first = await connectDesktop(bus, presence, new Set(['t1']))

    expect(connectedComputerCount()).toBe(before + 1)
    const second = await connectDesktop(bus, presence, new Set(['t1']))

    expect(connectedComputerCount()).toBe(before + 1)
    first.tunnel.closed()
    second.tunnel.closed()
    expect(connectedComputerCount()).toBe(before)
  })

  test('a restart closes every held tunnel with 1012, spread over the window', async () => {
    const bus = createLocalTunnelBus()
    const presence = createMemoryPresenceStore()
    const closes: { code: number; at: number }[] = []
    const held = await Promise.all(
      ['r1', 'r2', 'r3'].map((deviceId) =>
        attachRuntimeTunnel(
          'u-restart',
          deviceId,
          { send: () => {}, close: (code) => closes.push({ code, at: Date.now() }) },
          { bus, presence, isMember: async () => true, heartbeatMs: 60_000 },
        ),
      ),
    )

    tunnels.push(...held)
    const start = Date.now()

    closeTunnelsForRestart(90)
    await eventually(() => closes.length === 3)
    expect(closes.map((close) => close.code)).toEqual([1012, 1012, 1012])
    expect(closes[0]!.at - start).toBeLessThan(30)
    expect(closes[2]!.at - start).toBeGreaterThanOrEqual(55)
    expect(connectedComputerCount()).toBe(0)
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
    // It carried no stream, so no team was affected.
    expect(
      lines.find((line) => line.event === 'agent.local_runtime.tunnel_closed'),
    ).not.toHaveProperty('team_ids')
  })

  test('the opened tunnel logs which app holds it', async () => {
    const lines = await logged('log', async () => {
      tunnels.push(
        await attachRuntimeTunnel(
          owner.userId,
          owner.deviceId,
          { send: () => {}, close: () => {} },
          {
            bus: createLocalTunnelBus(),
            presence: createMemoryPresenceStore(),
            isMember: async () => true,
            heartbeatMs: 60_000,
          },
          'nuphos-desktop/1.2.3',
        ),
      )
    })

    expect(lines).toContainEqual(
      expect.objectContaining({
        event: 'agent.local_runtime.tunnel_opened',
        device_id: owner.deviceId,
        client: 'nuphos-desktop/1.2.3',
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

  test('data on a stream marks the computer used; a status read does not', async () => {
    const bus = createLocalTunnelBus()
    const presence = createMemoryPresenceStore()

    await connectDesktop(bus, presence, new Set(['t1']), { echo: true, heartbeatMs: 1 })
    const usedAt = async () => (await presence.get(owner.userId, owner.deviceId))?.usedAt ?? 0
    const opened = await usedAt()
    const exchange = async (purpose: string) => {
      const { socket, events } = openStream(bus, presence, 't1', owner.userId, purpose)

      await eventually(() => events.some((event) => event.type === 'open'))
      await new Promise((resolve) => setTimeout(resolve, 20))
      socket.send('{"jsonrpc":"2.0"}')
      await eventually(() => events.some((event) => event.type === 'message'))
      await tick()
    }

    expect(opened).toBeGreaterThan(0)
    await exchange('control')
    expect(await usedAt()).toBe(opened)
    await exchange('transport')
    expect(await usedAt()).toBeGreaterThan(opened)
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

test('a recovered model catalog is published before the next heartbeat', async () => {
  const presence = createMemoryPresenceStore()
  const tunnel = await attachRuntimeTunnel(
    'u1',
    'd1',
    { send() {}, close() {} },
    { bus: createLocalTunnelBus(), presence, isMember: async () => true, heartbeatMs: 60_000 },
  )

  tunnels.push(tunnel)
  const report = (failed: boolean) =>
    tunnel.receive(
      JSON.stringify({
        t: 'status',
        status: {
          agents: {
            codex: {
              cli: { installed: true, loggedIn: true },
              models: {
                models: failed ? [] : [{ id: 'fixture', name: 'Fixture' }],
                defaultModel: failed ? '' : 'fixture',
                controls: {},
                ...(failed ? { failed: true } : {}),
              },
            },
          },
        },
      }),
    )

  report(true)
  await tick()
  expect((await presence.get('u1', 'd1'))?.status?.agents.codex?.models?.failed).toBe(true)

  report(false)
  await tick()
  expect((await presence.get('u1', 'd1'))?.status?.agents.codex?.models?.models).toEqual([
    { id: 'fixture', name: 'Fixture' },
  ])
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
    publish: (channel, message) => (broken ? Promise.resolve(0) : bus.publish(channel, message)),
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

/** A bus whose channels can stop listening, as a subscriber does while it reconnects. */
function gappyBus() {
  const inner = createLocalTunnelBus()
  const deaf = new Set<string>()
  const bus: TunnelBus = {
    ...inner,
    publish: (channel, message) =>
      deaf.has(channel) ? Promise.resolve(0) : inner.publish(channel, message),
  }

  return { bus, deaf }
}

describe('a frame nobody receives', () => {
  test('from the backend: the stream ends, and the computer still hears the close', async () => {
    const { bus, deaf } = gappyBus()
    const presence = createMemoryPresenceStore()
    const desktop = await connectDesktop(bus, presence, new Set(['t1']), { echo: true })
    const { socket, events } = openStream(bus, presence, 't1')

    await eventually(() => events.some((event) => event.type === 'open'))
    const s = desktop.frames.find((frame) => frame.t === 'open')!.s

    deaf.add(holderChannel(owner.userId, owner.deviceId))
    socket.send('{"jsonrpc":"2.0","id":7,"result":{"outcome":{"outcome":"selected"}}}')
    await eventually(() => events.some((event) => event.type === 'close'))
    expect(desktop.frames.some((frame) => frame.t === 'data')).toBe(false)

    deaf.clear()
    await eventually(() => desktop.frames.some((frame) => frame.t === 'close' && frame.s === s))
  })

  test('from the computer: it ends there, and the backend learns on its next frame', async () => {
    const { bus, deaf } = gappyBus()
    const presence = createMemoryPresenceStore()
    const desktop = await connectDesktop(bus, presence, new Set(['t1']))
    const { socket, events } = openStream(bus, presence, 't1')

    await eventually(() => desktop.frames.some((frame) => frame.t === 'open'))
    const s = desktop.frames.find((frame) => frame.t === 'open')!.s

    desktop.send({ t: 'opened', s })
    await eventually(() => events.some((event) => event.type === 'open'))
    deaf.add(streamChannel(s))
    desktop.send({ t: 'data', s, d: '{"jsonrpc":"2.0","method":"session/request_permission"}' })
    await eventually(() => desktop.frames.some((frame) => frame.t === 'close' && frame.s === s))

    deaf.clear()
    socket.send('{"jsonrpc":"2.0","id":1,"result":{}}')
    await eventually(() => events.some((event) => event.type === 'close'))
    expect(events.find((event) => event.type === 'close')?.reason).toContain('lost')
  })
})

describe('a tunnel that hears nothing on its channel', () => {
  const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

  test('does not replace a subscriber that still hears its own probe', async () => {
    let reconnects = 0
    const check = guardedReconnect(
      createLocalTunnelBus(),
      () => {
        reconnects += 1
      },
      50,
    )

    check()
    await wait(80)
    expect(reconnects).toBe(0)
  })

  test('replaces a deaf subscriber once, however many tunnels ask', async () => {
    let reconnects = 0
    const deaf: TunnelBus = {
      publish: () => Promise.resolve(1),
      subscribe: () => Promise.resolve(() => {}),
    }
    const check = guardedReconnect(
      deaf,
      () => {
        reconnects += 1
      },
      20,
    )

    check()
    check()
    check()
    await wait(60)
    expect(reconnects).toBe(1)
  })

  test('blames nothing when the probe cannot even be published', async () => {
    let reconnects = 0
    const check = guardedReconnect(
      { ...createLocalTunnelBus(), publish: () => Promise.reject(new Error('client down')) },
      () => {
        reconnects += 1
      },
      20,
    )

    check()
    await wait(60)
    expect(reconnects).toBe(0)
  })
})
