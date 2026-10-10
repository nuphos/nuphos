import { afterEach, describe, expect, test } from 'bun:test'
import { Hono } from 'hono'
import { websocket } from 'hono/bun'

import { localRuntimeUrl } from '@/lib/agent/devices/local-runtime/address'
import { createLocalTunnelBus } from '@/lib/agent/devices/local-runtime/bus'
import { createMemoryPresenceStore } from '@/lib/agent/devices/local-runtime/presence'
import { openLocalRuntimeSocket } from '@/lib/agent/devices/local-runtime/socket'
import { errorHandler } from '@/lib/errors'
import {
  createDeviceRuntimeRoutes,
  runtimeTunnelEvents,
} from '@/routes/agent/routes-device-runtime'

import type { AuthVariables } from '@/middleware/auth'
import type { DeviceRuntimeRouteDependencies } from '@/routes/agent/routes-device-runtime'
import type { Server } from 'bun'
import type { WSContext } from 'hono/ws'

const bus = createLocalTunnelBus()
const presence = createMemoryPresenceStore()
let server: Server<unknown> | undefined

afterEach(async () => {
  await server?.stop(true)
  server = undefined
})

function deps(
  overrides: Partial<DeviceRuntimeRouteDependencies> = {},
): DeviceRuntimeRouteDependencies {
  return {
    getAgentDevice: async (userId, deviceId) =>
      userId === 'owner' && deviceId === 'd1'
        ? {
            userId,
            deviceId,
            label: 'Mac',
            platform: 'darwin',
            allowLocalExec: false,
            createdAt: new Date(),
            updatedAt: new Date(),
          }
        : null,
    holder: { bus, presence, heartbeatMs: 20, isMember: async (_u, teamId) => teamId === 't1' },
    listActivity: async () => ({ entries: [], nextCursor: null }),
    conversationTitlesFor: async () => new Map(),
    getTeamMembers: async () => [],
    ...overrides,
  }
}

function serve(userId: string, routeDeps = deps()): string {
  const app = new Hono<{ Variables: AuthVariables }>()

  app.use('*', async (c, next) => {
    c.set('userId', userId)
    await next()
  })
  app.route('/agent', createDeviceRuntimeRoutes(routeDeps))
  app.onError(errorHandler)
  server = Bun.serve({
    port: 0,
    websocket,
    fetch: (req, bunServer) => app.fetch(req, { server: bunServer }),
  })

  return `127.0.0.1:${String(server.port)}`
}

function waitFor<T>(register: (resolve: (value: T) => void) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('timed out'))
    }, 2_000)

    register((value) => {
      clearTimeout(timer)
      resolve(value)
    })
  })
}

describe('device runtime tunnel route', () => {
  test('a failed presence claim handles queued message and close callbacks without rejecting', async () => {
    let failClaim!: (error: Error) => void
    const closed: unknown[][] = []
    const events = runtimeTunnelEvents('owner', 'd1', {
      ...deps().holder,
      presence: {
        ...presence,
        claim: () =>
          new Promise((_resolve, reject) => {
            failClaim = reject
          }),
      },
    })

    events.onOpen(new Event('open'), {
      send: () => {},
      close: (...args: unknown[]) => {
        closed.push(args)
      },
    } as unknown as WSContext)
    events.onMessage(new MessageEvent('message', { data: JSON.stringify({ t: 'pong' }) }))
    events.onClose()
    await Bun.sleep(0)
    failClaim(new Error('Device presence unavailable'))
    // Bun fails this test on an unhandled child rejection, even when onOpen
    // catches the original rejected initialization promise.
    await Bun.sleep(10)
    expect(closed).toEqual([[1011, 'Could not open the runtime tunnel']])
  })

  test('the owner computer holds a tunnel that carries a stream end to end', async () => {
    const host = serve('owner')
    const desktop = new WebSocket(`ws://${host}/agent/devices/d1/runtime-tunnel`)

    desktop.addEventListener('message', (event) => {
      const frame = JSON.parse(String(event.data)) as { t: string; s?: string; d?: string }

      if (frame.t === 'ping') desktop.send(JSON.stringify({ t: 'pong' }))
      if (frame.t === 'open') desktop.send(JSON.stringify({ t: 'opened', s: frame.s }))
      if (frame.t === 'data')
        desktop.send(JSON.stringify({ t: 'data', s: frame.s, d: `pong:${String(frame.d)}` }))
    })
    await waitFor<void>((resolve) => {
      desktop.addEventListener('open', () => {
        resolve()
      })
    })
    desktop.send(
      JSON.stringify({
        t: 'status',
        status: { agents: { 'claude-code': { cli: { installed: true, loggedIn: true } } } },
      }),
    )
    await waitFor<void>((resolve) => {
      const poll = () =>
        void presence.get('owner', 'd1').then((found) => {
          if (found?.status) resolve()
          else setTimeout(poll, 5)
        })

      poll()
    })

    const socket = openLocalRuntimeSocket(
      localRuntimeUrl({ userId: 'owner', deviceId: 'd1', provider: 'claude-code' }, 't1'),
      ['openab.bearer.transport'],
      { bus, presence },
    )

    await waitFor<void>((resolve) => {
      socket.addEventListener('open', () => {
        resolve()
      })
    })
    const reply = waitFor<unknown>((resolve) => {
      socket.addEventListener('message', (event) => {
        resolve(event.data)
      })
    })

    socket.send('ping')
    expect(await reply).toBe('pong:ping')
    socket.close()
    desktop.close()
  })

  test('another user cannot hold a tunnel for a computer they do not own', async () => {
    const host = serve('intruder')
    const res = await fetch(`http://${host}/agent/devices/d1/runtime-tunnel`, {
      headers: { upgrade: 'websocket', connection: 'upgrade' },
    })

    expect(res.status).toBe(404)
  })

  test('activity is readable only by the computer owner', async () => {
    const entry = {
      ownerUserId: 'owner',
      deviceId: 'd1',
      teamId: 't1',
      sessionId: 's1',
      lastActorUserId: 'mate',
      firstServedAt: new Date('2026-09-01T00:00:00Z'),
      lastServedAt: new Date('2026-09-02T00:00:00Z'),
      turns: 3,
    }
    const routeDeps = deps({
      listActivity: async () => ({ entries: [entry], nextCursor: null }),
      conversationTitlesFor: async () => new Map([['s1', 'Fix the deploy']]),
      getTeamMembers: async () => [
        {
          id: 'mate',
          name: 'Mika',
          email: 'm@example.com',
          username: 'mika',
          avatarURL: '',
          language: 'en',
          createdAt: '',
          role: 'EDITOR',
          joinedAt: '',
        },
      ],
    })
    const owner = await fetch(
      `http://${serve('owner', routeDeps)}/agent/devices/d1/runtime-activity`,
    )

    expect(await owner.json()).toMatchObject({
      entries: [
        { sessionId: 's1', conversationTitle: 'Fix the deploy', actorName: 'Mika', turns: 3 },
      ],
    })
    await server?.stop(true)
    const intruder = await fetch(
      `http://${serve('intruder', routeDeps)}/agent/devices/d1/runtime-activity`,
    )

    expect(intruder.status).toBe(404)
  })
})
