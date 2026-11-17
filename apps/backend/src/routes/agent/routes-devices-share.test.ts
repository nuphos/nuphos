import { expect, test } from 'bun:test'
import { Hono } from 'hono'

import { AppError } from '@/lib/errors'

import { createDeviceShareRoutes } from './routes-devices-share'

import type { DeviceShareRouteDependencies } from './routes-devices-share'
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

function app(options: { device?: AgentDevice; userId?: string; stored?: string[] } = {}) {
  const device = options.device ?? computer()
  // The team's managers in the database now; by default, what the request read.
  const stored = options.stored ?? device.access?.find((grant) => grant.teamId === TEAM)?.managerIds
  const calls: {
    set?: { everyone: boolean; userIds: string[] }
    managers?: string[]
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
      listGranted: () => Promise.resolve(device.access ? [device] : []),
      findGranted: () => Promise.resolve(device.access && !device.box ? [device] : []),
      role: async () => 'EDITOR',
    },
    isMember: async () => true,
    teamMembers: async () => [{ id: 'owner' }, { id: 'mate' }, { id: 'other' }],
    getDevice: async () => device,
    setUse: async (_owner, _device, _team, use, _by, managers) => {
      // As the guarded update: managers that followed from a read need that read to still hold.
      if (managers?.read && managers.read.join() !== (stored ?? []).join())
        throw new AppError(409, 'access_changed', 'Access changed while you were editing')
      calls.push({ set: use, managers: managers?.ids })

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
  // The owner is never in their own list; only members are kept, and any level means use.
  expect(calls[0]?.set).toEqual({ everyone: false, userIds: ['mate'] })
  expect(calls[1]?.revoked).toEqual(['other'])
  expect(calls[2]?.dropped).toEqual(['other'])
})

test('turning sharing off empties the list and revokes everyone', async () => {
  const { put, calls } = app()
  const response = await put({ level: 'off', everyone: true, userIds: [] })

  expect(response.status).toBe(200)
  expect(calls[0]?.set).toEqual({ everyone: false, userIds: [] })
  expect(calls[1]?.revoked).toEqual(['mate', 'other'])
})

test('nothing caps sharing: any level is use, and the answer says full', async () => {
  const response = await app().put({ level: 'full', everyone: true, userIds: [] })

  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({
    share: { level: 'full', everyone: true, userIds: [] },
    ceiling: 'full',
    managerIds: [],
  })
})

test('a manager of a teammate’s computer lets others use it', async () => {
  const device = computer({
    access: [{ teamId: TEAM, everyone: false, userIds: [], managerIds: ['lead'] }],
  })
  const { put, calls } = app({ device, userId: 'lead' })

  expect((await put({ level: 'approve', everyone: false, userIds: ['mate'] })).status).toBe(200)
  // Its managers stay, and stay in the use list.
  expect(calls[0]).toEqual({
    set: { everyone: false, userIds: ['mate', 'lead'] },
    managers: ['lead'],
  })
  // Revoking spares the owner and managers.
  expect(calls[1]?.revoked).toEqual(['other'])
})

test('the owner makes a teammate a manager, who also uses it', async () => {
  const { put, calls } = app()
  const response = await put({
    level: 'full',
    everyone: false,
    userIds: [],
    managerIds: ['mate', 'owner', 'stranger'],
  })

  expect(response.status).toBe(200)
  // Only the team's other members manage; managing includes using, so an older release sees them.
  expect(calls[0]).toEqual({ set: { everyone: false, userIds: ['mate'] }, managers: ['mate'] })
  expect(calls[1]?.revoked).toEqual(['other'])
  expect(await response.json()).toMatchObject({
    share: { everyone: false, userIds: ['mate'] },
    managerIds: ['mate'],
  })
})

// A teammate who manages the computer, and so is in its use list too.
const managedByMate = () =>
  computer({
    access: [{ teamId: TEAM, everyone: false, userIds: ['mate'], managerIds: ['mate'] }],
  })

test('a manager moved to use keeps using it; moved to no access loses both', async () => {
  const toUse = app({ device: managedByMate() })

  await toUse.put({ level: 'full', everyone: false, userIds: ['mate'], managerIds: [] })
  expect(toUse.calls[0]).toEqual({ set: { everyone: false, userIds: ['mate'] }, managers: [] })
  expect(toUse.calls[1]?.revoked).toEqual(['other'])
  const toNone = app({ device: managedByMate() })

  await toNone.put({ level: 'off', everyone: false, userIds: [], managerIds: [] })
  expect(toNone.calls[0]).toEqual({ set: { everyone: false, userIds: [] }, managers: [] })
  expect(toNone.calls[1]?.revoked).toEqual(['mate', 'other'])
})

// An owner on a release that knows only the use list: who it no longer lets use the computer
// stops managing it too.
const twoManagers = () =>
  computer({
    access: [
      { teamId: TEAM, everyone: false, userIds: ['mate', 'other'], managerIds: ['mate', 'other'] },
    ],
  })

test('a released desktop turning sharing off clears the managers and closes their streams', async () => {
  const { put, calls } = app({ device: twoManagers() })

  await put({ level: 'off', everyone: false, userIds: [] })
  expect(calls[0]).toEqual({ set: { everyone: false, userIds: [] }, managers: [] })
  expect(calls[1]?.revoked).toEqual(['mate', 'other'])
})

test('a released desktop unchecking a manager removes their manage and use', async () => {
  const { put, calls } = app({ device: twoManagers() })

  await put({ level: 'full', everyone: false, userIds: ['other'] })
  expect(calls[0]).toEqual({ set: { everyone: false, userIds: ['other'] }, managers: ['other'] })
  expect(calls[1]?.revoked).toEqual(['mate'])
})

test('a released desktop saving the same list keeps every manager', async () => {
  const { put, calls } = app({ device: twoManagers() })

  await put({ level: 'full', everyone: false, userIds: ['mate', 'other'] })
  expect(calls).toEqual([
    { set: { everyone: false, userIds: ['mate', 'other'] }, managers: ['mate', 'other'] },
  ])
})

test('a released desktop letting everyone use it keeps every manager', async () => {
  const { put, calls } = app({ device: twoManagers() })

  await put({ level: 'full', everyone: true, userIds: [] })
  expect(calls).toEqual([
    { set: { everyone: true, userIds: ['mate', 'other'] }, managers: ['mate', 'other'] },
  ])
})

test('a save from a stale read gets access_changed, and the stored managers stay', async () => {
  // The owner has just removed Mate as a manager; Lead saves from the dialog opened before.
  const device = twoManagers()
  const lead = computer({
    access: [
      { teamId: TEAM, everyone: false, userIds: ['lead', 'mate'], managerIds: ['lead', 'mate'] },
    ],
  })
  const manager = app({ device: lead, userId: 'lead', stored: ['lead'] })
  const response = await manager.put({ level: 'full', everyone: false, userIds: ['lead', 'mate'] })

  expect(response.status).toBe(409)
  expect(await response.json()).toEqual({ error: 'access_changed' })
  expect(manager.calls).toEqual([])
  // An owner on a released desktop, whose kept managers follow from the read, is checked too.
  const owner = app({ device, stored: ['other'] })

  expect(
    (await owner.put({ level: 'full', everyone: false, userIds: ['mate', 'other'] })).status,
  ).toBe(409)
  expect(owner.calls).toEqual([])
})

test('a save from a fresh read goes through, and the owner naming managers needs no read', async () => {
  const fresh = app({ device: twoManagers() })

  expect(
    (await fresh.put({ level: 'full', everyone: false, userIds: ['mate', 'other'] })).status,
  ).toBe(200)
  // The owner decides the managers outright, so a changed store does not stop them.
  const owner = app({ device: twoManagers(), stored: ['other'] })
  const response = await owner.put({
    level: 'full',
    everyone: false,
    userIds: ['mate'],
    managerIds: ['mate'],
  })

  expect(response.status).toBe(200)
  expect(owner.calls[0]).toEqual({
    set: { everyone: false, userIds: ['mate'] },
    managers: ['mate'],
  })
})

test('only the owner changes managers; a manager may only repeat them', async () => {
  const device = computer({
    access: [{ teamId: TEAM, everyone: false, userIds: ['lead'], managerIds: ['lead'] }],
  })
  const lead = app({ device, userId: 'lead' })
  const changed = await lead.put({
    level: 'full',
    everyone: false,
    userIds: [],
    managerIds: ['lead', 'mate'],
  })

  expect(changed.status).toBe(403)
  expect(await changed.json()).toEqual({ error: 'owner_only' })
  expect(lead.calls).toEqual([])
  const repeated = await lead.put({
    level: 'full',
    everyone: false,
    userIds: ['mate'],
    managerIds: ['lead'],
  })

  expect(repeated.status).toBe(200)
})

test('a Box or someone else’s computer cannot be shared this way', async () => {
  const box = app({ device: computer({ box: { provider: 'instabox', teamId: TEAM } }) })
  const someoneElse = app({ userId: 'mate' })

  expect((await box.put({ level: 'approve', everyone: true, userIds: [] })).status).toBe(404)
  expect((await someoneElse.put({ level: 'approve', everyone: true, userIds: [] })).status).toBe(
    404,
  )
})

test('reads the current use list as a share', async () => {
  const { server } = app({
    device: computer({
      access: [{ teamId: TEAM, everyone: false, userIds: ['mate'], managerIds: [] }],
    }),
  })
  const response = await server.request(`/devices/mac/share?teamId=${TEAM}`)

  expect(await response.json()).toEqual({
    share: { level: 'full', everyone: false, userIds: ['mate'] },
    ceiling: 'full',
    managerIds: [],
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
