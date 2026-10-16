import { expect, test } from 'bun:test'
import { Hono } from 'hono'

import { createDeviceAgentRoutes } from './routes-device-agents'

import type { DeviceAgentRouteDeps } from './routes-device-agents'
import type { AuthVariables } from '@/middleware/auth'

const id = '11111111-1111-4111-8111-111111111111'
const device = {
  userId: 'owner',
  deviceId: 'box',
  label: 'Box',
  platform: 'linux',
  allowLocalExec: true,
  createdAt: new Date(0),
  updatedAt: new Date(0),
}

function app(overrides: Partial<DeviceAgentRouteDeps> = {}) {
  const calls: unknown[] = []
  const deps: DeviceAgentRouteDeps = {
    requireAccess: async () => device,
    isMember: async (_userId, teamId) => teamId === '69e989027ab63e8d6a0ffcb6',
    getPresence: async () => ({
      conn: 'c1',
      seenAt: Date.now(),
      status: { agents: {}, agentInstances: true },
    }),
    createInstance: async (target, instance) => {
      calls.push({ target, instance })

      return instance
    },
    removeInstance: async (target, agent) => {
      calls.push({ target, removed: agent })
    },
    forgetAgent: async (userId, deviceId, agent) => {
      calls.push({ forgot: [userId, deviceId, agent] })
    },
    renameAgent: async (userId, deviceId, key, label) => {
      calls.push({ renamed: [userId, deviceId, key, label] })

      return key === id || key === 'claude-code'
    },
    ...overrides,
  }
  const server = new Hono<{ Variables: AuthVariables }>()

  server.use('*', async (c, next) => {
    c.set('userId', 'owner')
    await next()
  })
  server.onError((error, c) =>
    c.json({ error: error.message }, 'status' in error ? (error.status as 400) : 500),
  )
  server.route('/', createDeviceAgentRoutes(deps))
  const create = (body: unknown) =>
    server.request('/devices/box/agents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ teamId: '69e989027ab63e8d6a0ffcb6', ...(body as object) }),
    })

  const remove = (instanceId: string) =>
    server.request(`/devices/box/agents/${instanceId}?teamId=69e989027ab63e8d6a0ffcb6`, {
      method: 'DELETE',
    })

  const rename = (agent: string, label: string) =>
    server.request(`/devices/box/agents/${agent}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ teamId: '69e989027ab63e8d6a0ffcb6', label }),
    })

  return { create, remove, rename, calls }
}

test('create dispatches exact retry id and provider and returns a usable runtime id', async () => {
  const { create, calls } = app()
  const response = await create({ provider: 'claude-code', label: 'Work', instanceId: id })

  expect(response.status).toBe(201)
  expect(await response.json()).toEqual({
    instanceId: id,
    provider: 'claude-code',
    label: 'Work',
    runtimeId: `local_owner_box_claude-code_${id}`,
  })
  expect(calls).toEqual([
    {
      target: {
        userId: 'owner',
        actorId: 'owner',
        deviceId: 'box',
        teamId: '69e989027ab63e8d6a0ffcb6',
      },
      instance: { instanceId: id, provider: 'claude-code', label: 'Work' },
    },
  ])
})

test('unknown devices and hosts without instance support never receive create', async () => {
  for (const override of [
    {
      requireAccess: async () => {
        throw Object.assign(new Error('Unavailable'), { status: 404 })
      },
    },
    { getPresence: async () => ({ conn: 'c1', seenAt: Date.now(), status: { agents: {} } }) },
  ]) {
    const { create, calls } = app(override)
    const response = await create({ provider: 'codex' })

    expect([404, 409]).toContain(response.status)
    expect(calls).toEqual([])
  }
})

test('invalid provider and path-shaped instance ids are refused', async () => {
  const { create, calls } = app()

  expect((await create({ provider: 'unknown' })).status).toBe(400)
  expect((await create({ provider: 'codex', instanceId: '../../auth' })).status).toBe(400)
  expect(calls).toEqual([])
})

test('management authorizes the actor and dispatches to the durable transport owner', async () => {
  const { create, calls } = app({
    requireAccess: async (actorId, teamId, deviceId, level) => {
      expect([actorId, teamId, deviceId, level]).toEqual([
        'owner',
        '69e989027ab63e8d6a0ffcb6',
        'box',
        'manage',
      ])

      return { ...device, userId: 'transport-owner' }
    },
  })
  const response = await create({ provider: 'codex', instanceId: id })

  expect(response.status).toBe(201)
  expect(calls).toMatchObject([{ target: { actorId: 'owner', userId: 'transport-owner' } }])
  expect(await response.json()).toMatchObject({
    runtimeId: `local_transport-owner_box_codex_${id}`,
  })
})

test('remove is managed, reaches the transport owner, and refuses a default agent', async () => {
  const levels: string[] = []
  const { remove, calls } = app({
    requireAccess: async (_actorId, _teamId, _deviceId, level) => {
      levels.push(level)

      return { ...device, userId: 'transport-owner' }
    },
  })

  expect((await remove(id)).status).toBe(204)
  expect(levels).toEqual(['manage'])
  expect(calls).toMatchObject([
    {
      target: { actorId: 'owner', userId: 'transport-owner', deviceId: 'box' },
      removed: { instanceId: id },
    },
    { forgot: ['transport-owner', 'box', { instanceId: id }] },
  ])
  for (const bad of ['default-codex', 'grok', 'x']) expect((await remove(bad)).status).toBe(400)
  expect(calls).toHaveLength(2)
})

test("a Box removes its default agent; a person's computer refuses to", async () => {
  const box = { ...device, box: {} as never }
  const onBox = app({ requireAccess: async () => box })

  expect((await onBox.remove('codex')).status).toBe(204)
  expect(onBox.calls).toMatchObject([
    { removed: { provider: 'codex' } },
    { forgot: ['owner', 'box', { provider: 'codex' }] },
  ])
  const computer = app()

  expect((await computer.remove('claude-code')).status).toBe(400)
  expect(computer.calls).toEqual([])
})

test('remove without access or on an older host never reaches the host', async () => {
  for (const override of [
    {
      requireAccess: async () => {
        throw Object.assign(new Error('Unavailable'), { status: 404 })
      },
    },
    { getPresence: async () => ({ conn: 'c1', seenAt: Date.now(), status: { agents: {} } }) },
  ]) {
    const { remove, calls } = app(override)

    expect([404, 409]).toContain((await remove(id)).status)
    expect(calls).toEqual([])
  }
})

test('rename is managed, works offline, and names the transport owner’s registry entry', async () => {
  const levels: string[] = []
  const { rename, calls } = app({
    requireAccess: async (_actorId, _teamId, _deviceId, level) => {
      levels.push(level)

      return { ...device, userId: 'transport-owner' }
    },
    getPresence: async () => null,
  })

  expect((await rename(id, '  Review  ')).status).toBe(200)
  expect((await rename('claude-code', '')).status).toBe(200)
  expect((await rename('codex', 'Mine')).status).toBe(404)
  expect(levels).toEqual(['manage', 'manage', 'manage'])
  expect(calls).toEqual([
    { renamed: ['transport-owner', 'box', id, 'Review'] },
    { renamed: ['transport-owner', 'box', 'claude-code', ''] },
    { renamed: ['transport-owner', 'box', 'codex', 'Mine'] },
  ])
})

test('a member who may only use the Box cannot rename its agents', async () => {
  const { rename, calls } = app({
    requireAccess: async (_actorId, _teamId, _deviceId, level) => {
      if (level === 'manage') throw Object.assign(new Error('Unavailable'), { status: 404 })

      return device
    },
  })

  expect((await rename(id, 'Mine')).status).toBe(404)
  expect(calls).toEqual([])
})
