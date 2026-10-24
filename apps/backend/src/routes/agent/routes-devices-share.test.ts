import { expect, test } from 'bun:test'
import { Hono } from 'hono'

import { createDeviceShareRoutes } from './routes-devices-share'

import type { DeviceShareRouteDependencies } from './routes-devices-share'
import type { LocalAgentShare, LocalShareLevel } from '@/lib/agent/devices/local-share-types'
import type { AgentDevice } from '@/lib/agent/devices/store'
import type { AuthVariables } from '@/middleware/auth'

const TEAM = '69e989027ab63e8d6a0ffcb6'
const computer = (extra: Partial<AgentDevice> = {}): AgentDevice => ({
  userId: 'owner',
  deviceId: 'mac',
  label: 'Mac',
  platform: 'darwin',
  allowLocalExec: true,
  createdAt: new Date(0),
  updatedAt: new Date(0),
  ...extra,
})

function app(options: { device?: AgentDevice; ceiling?: LocalShareLevel; userId?: string } = {}) {
  const device = options.device ?? computer()
  const calls: { set?: LocalAgentShare | null; revoked?: string[]; dropped?: string[] }[] = []
  const deps: DeviceShareRouteDependencies = {
    access: {
      getDevice: async (userId) => (userId === device.userId ? device : null),
      listDevices: async () => [device],
      listBoxes: async () => (device.box ? [device] : []),
      role: async () => 'EDITOR',
    },
    ceiling: async () => options.ceiling ?? 'approve',
    isMember: async () => true,
    teamMembers: async () => [{ id: 'owner' }, { id: 'mate' }, { id: 'other' }],
    getDevice: async () => device,
    setShare: async (_owner, _device, _team, share) => {
      calls.push({ set: share })

      return true
    },
    revokeStreams: async (_devices, actorIds) => {
      calls.push({ revoked: actorIds })
    },
    dropApprovals: async (_owner, _device, _team, actorIds) => {
      calls.push({ dropped: actorIds })
    },
    pendingApprovals: async () => [],
    decide: async (_owner, approvalId, approve) =>
      approvalId === 'known'
        ? {
            _id: 'known',
            ownerId: 'owner',
            deviceId: 'mac',
            teamId: TEAM,
            sessionId: 's1',
            actorId: 'mate',
            status: approve ? 'approved' : 'denied',
            requestedAt: new Date(0),
          }
        : null,
  }
  const server = new Hono<{ Variables: AuthVariables }>()

  server.use('*', async (c, next) => {
    c.set('userId', options.userId ?? 'owner')
    await next()
  })
  server.onError((error, c) =>
    c.json(
      { error: 'code' in error ? error.code : error.message },
      'status' in error ? (error.status as 400) : 500,
    ),
  )
  server.route('/', createDeviceShareRoutes(deps))
  const put = (body: unknown) =>
    server.request(`/devices/mac/share?teamId=${TEAM}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })

  return { server, put, calls }
}

test('an owner shares with chosen teammates; the rest lose their streams', async () => {
  const { put, calls } = app()
  const response = await put({ level: 'approve', everyone: false, userIds: ['mate', 'owner'] })

  expect(response.status).toBe(200)
  // The owner is never in their own share; only members are kept.
  expect(calls[0]?.set).toEqual({
    teamId: TEAM,
    level: 'approve',
    everyone: false,
    userIds: ['mate'],
  })
  expect(calls[1]?.revoked).toEqual(['other'])
  expect(calls[2]?.dropped).toEqual(['other'])
})

test('turning sharing off removes the share and revokes everyone', async () => {
  const { put, calls } = app()
  const response = await put({ level: 'off', everyone: true, userIds: [] })

  expect(response.status).toBe(200)
  expect(calls[0]?.set).toBeNull()
  expect(calls[1]?.revoked).toEqual(['mate', 'other'])
})

test('an owner cannot grant more than the team ceiling', async () => {
  const { put, calls } = app({ ceiling: 'approve' })
  const response = await put({ level: 'full', everyone: true, userIds: [] })

  expect(response.status).toBe(403)
  expect(await response.json()).toEqual({ error: 'local_share_above_ceiling' })
  expect(calls).toEqual([])
  expect(
    (await app({ ceiling: 'full' }).put({ level: 'full', everyone: true, userIds: [] })).status,
  ).toBe(200)
})

test('a Box or someone else’s computer cannot be shared this way', async () => {
  const box = app({ device: computer({ box: { provider: 'instabox', teamId: TEAM } }) })
  const someoneElse = app({ userId: 'mate' })

  expect((await box.put({ level: 'approve', everyone: true, userIds: [] })).status).toBe(404)
  expect((await someoneElse.put({ level: 'approve', everyone: true, userIds: [] })).status).toBe(
    404,
  )
})

test('reads the current share and the ceiling', async () => {
  const { server } = app({
    device: computer({
      shares: [{ teamId: TEAM, level: 'full', everyone: false, userIds: ['mate'] }],
    }),
    ceiling: 'full',
  })
  const response = await server.request(`/devices/mac/share?teamId=${TEAM}`)

  expect(await response.json()).toEqual({
    share: { level: 'full', everyone: false, userIds: ['mate'] },
    ceiling: 'full',
  })
})

test('an approval is answered once', async () => {
  const { server } = app()
  const answer = (approvalId: string) =>
    server.request(`/devices/share-approvals/${approvalId}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ approve: true }),
    })

  expect(await (await answer('known')).json()).toEqual({ id: 'known', status: 'approved' })
  expect((await answer('gone')).status).toBe(404)
})
