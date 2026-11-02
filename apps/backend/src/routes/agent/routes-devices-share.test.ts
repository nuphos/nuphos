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
  const calls: {
    set?: LocalAgentShare | null
    revoked?: string[]
    dropped?: string[]
    settled?: string
    trusted?: string
    untrusted?: string[]
  }[] = []
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
    pendingApprovals: async () => [
      {
        _id: 'waiting',
        ownerId: 'owner',
        deviceId: 'mac',
        teamId: TEAM,
        sessionId: 's1',
        actorId: 'mate',
        status: 'pending',
        requestedAt: new Date(0),
      },
    ],
    decide: async (_owner, approvalId, approve) =>
      approvalId === 'known' || approvalId === 'waiting'
        ? {
            _id: approvalId,
            ownerId: 'owner',
            deviceId: 'mac',
            teamId: TEAM,
            sessionId: approvalId === 'known' ? 's1' : 's2',
            actorId: 'mate',
            status: approve ? 'approved' : 'denied',
            requestedAt: new Date(0),
          }
        : null,
    pendingFrom: async ({ actorId, deviceId }) =>
      actorId === 'mate' && deviceId === 'mac'
        ? [
            {
              _id: 'waiting',
              ownerId: 'owner',
              deviceId: 'mac',
              teamId: TEAM,
              sessionId: 's2',
              actorId: 'mate',
              status: 'pending',
              requestedAt: new Date(0),
            },
          ]
        : [],
    settleQueue: async (approval) => {
      calls.push({ settled: `${approval.sessionId}:${approval.status}` })
    },
    trust: async ({ actorId, deviceId, duration }) => {
      calls.push({ trusted: `${actorId}@${deviceId}:${duration}` })
    },
    listTrusts: async () => [
      {
        _id: 't1',
        ownerId: 'owner',
        deviceId: 'mac',
        teamId: TEAM,
        actorId: 'mate',
        expiresAt: new Date('2026-10-30T12:00:00Z'),
        createdAt: new Date(0),
      },
      {
        _id: 't2',
        ownerId: 'owner',
        deviceId: 'mac',
        teamId: TEAM,
        actorId: 'other',
        createdAt: new Date(0),
      },
    ],
    dropTrusts: async (_owner, _device, _team, actorIds) => {
      calls.push({ untrusted: actorIds })
    },
    conversationTitles: async () => new Map([['s1', 'Today’s weather']]),
    ownApproval: async (sessionId, actorId) =>
      sessionId === 's1' && actorId === 'mate'
        ? {
            _id: 'waiting',
            ownerId: 'owner',
            deviceId: 'mac',
            teamId: TEAM,
            sessionId: 's1',
            actorId: 'mate',
            status: 'pending',
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

test('an approval is answered once, and starts what waited for it', async () => {
  const { server, calls } = app()
  const answer = (approvalId: string) =>
    server.request(`/devices/share-approvals/${approvalId}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ approve: true }),
    })

  expect(await (await answer('known')).json()).toEqual({ id: 'known', status: 'approved' })
  expect((await answer('gone')).status).toBe(404)
  expect(calls).toEqual([{ settled: 's1:approved' }])
})

test('the owner sees which conversation asks', async () => {
  const { server } = app()
  const response = await server.request(`/devices/share-approvals?teamId=${TEAM}`)

  expect(((await response.json()) as { approvals: unknown }).approvals).toEqual([
    {
      id: 'waiting',
      deviceId: 'mac',
      deviceLabel: 'Mac',
      sessionId: 's1',
      title: 'Today’s weather',
      actorId: 'mate',
      requestedAt: new Date(0).toISOString(),
    },
  ])
})

test('the requester sees whether their own conversation still waits', async () => {
  const status = async (userId: string, sessionId: string) =>
    (await (
      await app({ userId }).server.request(`/devices/share-approvals/mine?sessionId=${sessionId}`)
    ).json()) as { status: string | null }

  expect(await status('mate', 's1')).toEqual({ status: 'pending' })
  expect(await status('other', 's1')).toEqual({ status: null })
  expect(await status('mate', 's2')).toEqual({ status: null })
})

test('approving with trust also lets the teammate’s other waiting conversations on it go', async () => {
  const { server, calls } = app()
  const response = await server.request('/devices/share-approvals/known', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ approve: true, trust: '8h' }),
  })

  expect(await response.json()).toEqual({ id: 'known', status: 'approved' })
  expect(calls).toEqual([
    { trusted: 'mate@mac:8h' },
    { settled: 's1:approved' },
    { settled: 's2:approved' },
  ])
})

test('a refusal never trusts, and an unknown duration is rejected', async () => {
  const { server, calls } = app()
  const answer = (body: unknown) =>
    server.request('/devices/share-approvals/known', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })

  expect((await answer({ approve: false, trust: 'always' })).status).toBe(200)
  expect(calls).toEqual([{ settled: 's1:denied' }])
  expect((await answer({ approve: true, trust: 'forever' })).status).toBe(400)
})

test('the owner lists who they trust and takes it back', async () => {
  const { server, calls } = app()
  const listed = await server.request(`/devices/mac/share-trusts?teamId=${TEAM}`)

  expect(await listed.json()).toEqual({
    trusts: [
      { actorId: 'mate', expiresAt: '2026-10-30T12:00:00.000Z' },
      { actorId: 'other', expiresAt: null },
    ],
  })

  const dropped = await server.request(`/devices/mac/share-trusts/mate?teamId=${TEAM}`, {
    method: 'DELETE',
  })

  expect(dropped.status).toBe(200)
  expect(calls).toEqual([{ untrusted: ['mate'] }])
})

test('only the owner of the computer sees or changes its trusts', async () => {
  const { server } = app({ userId: 'mate' })

  expect((await server.request(`/devices/mac/share-trusts?teamId=${TEAM}`)).status).toBe(404)
  expect(
    (await server.request(`/devices/mac/share-trusts/other?teamId=${TEAM}`, { method: 'DELETE' }))
      .status,
  ).toBe(404)
})

test('teammates who lose the share lose the trust too', async () => {
  const { server, calls } = app()

  await server.request(`/devices/mac/share?teamId=${TEAM}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ level: 'approve', everyone: false, userIds: ['mate'] }),
  })
  expect(calls).toContainEqual({ untrusted: ['other'] })
})

test('leaving “Ask me first” forgets every trust on the computer', async () => {
  const { server, calls } = app({ ceiling: 'full' })

  await server.request(`/devices/mac/share?teamId=${TEAM}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ level: 'full', everyone: true, userIds: [] }),
  })
  expect(calls.some((call) => 'untrusted' in call && call.untrusted === undefined)).toBe(true)
})
