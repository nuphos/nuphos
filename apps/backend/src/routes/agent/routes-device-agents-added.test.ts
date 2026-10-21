import { expect, test } from 'bun:test'
import { Hono } from 'hono'

import { createDeviceAgentRoutes } from './routes-device-agents'

import type { DeviceAgentRouteDeps } from './routes-device-agents'
import type { LocalRuntimeStatus } from '@/lib/agent/devices/local-runtime/protocol'
import type { AgentDevice } from '@/lib/agent/devices/store'
import type { AuthVariables } from '@/middleware/auth'

const team = '69e989027ab63e8d6a0ffcb6'
const id = '11111111-1111-4111-8111-111111111111'
const box: AgentDevice = {
  userId: 'transport-owner',
  deviceId: 'box',
  label: 'Box',
  platform: 'linux',
  allowLocalExec: true,
  createdAt: new Date(0),
  updatedAt: new Date(0),
}

/** `actor` may use the Box; only `admin` manages it. */
function app(
  actor: string,
  { device = box, status = {} }: { device?: AgentDevice; status?: Partial<LocalRuntimeStatus> },
  overrides: Partial<DeviceAgentRouteDeps> = {},
) {
  const log: unknown[] = []
  const deps: DeviceAgentRouteDeps = {
    requireAccess: (actorId, _teamId, _deviceId, level) =>
      level === 'manage' && actorId !== 'admin'
        ? Promise.reject(Object.assign(new Error('Unavailable'), { status: 404 }))
        : Promise.resolve(device),
    isMember: () => Promise.resolve(true),
    getPresence: () =>
      Promise.resolve({
        conn: 'c1',
        seenAt: Date.now(),
        status: { agents: {}, agentInstances: true, ...status },
      }),
    createInstance: (_target, instance) => {
      log.push(['created', instance.instanceId])

      return Promise.resolve(instance)
    },
    removeInstance: (_target, agent) => {
      log.push(['removed', agent])

      return Promise.resolve()
    },
    forgetAgent: () => Promise.resolve(),
    renameAgent: () => Promise.resolve(true),
    recordAddition: (userId, deviceId, addition) => {
      log.push(['noted', userId, deviceId, addition])

      return Promise.resolve()
    },
    forgetAddition: (userId, deviceId, instanceId) => {
      log.push(['forgot', userId, deviceId, instanceId])

      return Promise.resolve()
    },
    ...overrides,
  }
  const server = new Hono<{ Variables: AuthVariables }>()

  server.use('*', async (c, next) => {
    c.set('userId', actor)
    await next()
  })
  server.onError((error, c) =>
    c.json({ error: error.message }, 'status' in error ? (error.status as 400) : 500),
  )
  server.route('/', createDeviceAgentRoutes(deps))

  return {
    log,
    create: (body: object) =>
      server.request('/devices/box/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ teamId: team, provider: 'codex', ...body }),
      }),
    remove: () => server.request(`/devices/box/agents/${id}?teamId=${team}`, { method: 'DELETE' }),
  }
}

const cli = { cli: { installed: true, loggedIn: false } }
const onHost = (state?: 'pending' | 'ready') => ({
  instances: [
    {
      instanceId: id,
      provider: 'codex' as const,
      label: 'Codex',
      ...(state ? { state } : {}),
      ...cli,
    },
  ],
})

test('a new agent notes its adder under the transport owner before the host makes it', async () => {
  const before = Date.now()
  const { create, log } = app('member', {})

  expect((await create({ label: 'Review', instanceId: id })).status).toBe(201)
  expect(log).toMatchObject([
    ['noted', 'transport-owner', 'box', { instanceId: id, userId: 'member' }],
    ['created', id],
  ])
  expect((log[0] as [string, string, string, { at: Date }])[3].at.getTime()).toBeGreaterThan(
    before - 1,
  )
})

test('an id the host already has, registered or pending, is a retry and notes nobody', async () => {
  const registered = {
    ...box,
    agents: [{ provider: 'codex' as const, instanceId: id, signedIn: true }],
  }

  for (const setup of [{ device: registered }, { status: onHost('pending') }]) {
    const { create, log } = app('member', setup)

    expect((await create({ instanceId: id })).status).toBe(201)
    expect(log).toEqual([['created', id]])
  }
})

test('a create the host refuses forgets its note; one refused up front notes nothing', async () => {
  const failing = app(
    'member',
    {},
    {
      createInstance: () =>
        Promise.reject(
          Object.assign(new Error('The Box did not answer in time.'), { status: 504 }),
        ),
    },
  )

  expect((await failing.create({ instanceId: id })).status).toBe(504)
  expect(failing.log.map((entry) => (entry as unknown[]).slice(0, 2))).toEqual([
    ['noted', 'transport-owner'],
    ['forgot', 'transport-owner'],
  ])
  expect(failing.log[1]).toEqual(['forgot', 'transport-owner', 'box', id])
  const offline = app('member', {}, { getPresence: () => Promise.resolve(null) })

  expect((await offline.create({})).status).toBe(409)
  expect(offline.log).toEqual([])
})

test('whoever added an agent may remove it until it signs in; nobody else who only uses the Box may', async () => {
  const added = { ...box, addedAgents: [{ instanceId: id, userId: 'member', at: new Date() }] }
  const signedIn = {
    ...added,
    agents: [{ provider: 'codex' as const, instanceId: id, signedIn: true }],
  }
  const cases: [string, Parameters<typeof app>[1], number][] = [
    ['member', { device: added, status: onHost('pending') }, 204],
    ['member', { device: added }, 204],
    ['other', { device: added, status: onHost('pending') }, 404],
    ['member', { device: added, status: onHost('ready') }, 404],
    // An older host reports no state: that may be a signed-in agent.
    ['member', { device: added, status: onHost() }, 404],
    ['member', { device: signedIn }, 404],
    ['member', { device: box, status: onHost('pending') }, 404],
    ['admin', { device: signedIn }, 204],
  ]

  for (const [actor, setup, status] of cases) {
    const { remove, log } = app(actor, setup)

    expect([actor, (await remove()).status]).toEqual([actor, status])
    expect(log).toEqual(status === 204 ? [['removed', { instanceId: id }]] : [])
  }
})
