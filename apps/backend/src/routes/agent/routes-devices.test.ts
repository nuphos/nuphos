import { beforeEach, describe, expect, test } from 'bun:test'
import { Hono } from 'hono'

import { forgetDeviceShares } from '@/lib/agent/devices/local-share-revoke'
import { errorHandler } from '@/lib/errors'
import { useDb } from '@/lib/test/doubles/db'
import { createAgentDeviceRoutes } from '@/routes/agent/routes-devices'
import { nextBoxLabel } from '@/routes/agent/routes-devices-box'

import type { DeviceExecAuditEntry } from '@/lib/agent/devices/audit'
import type { AgentDevice, AgentDeviceRegistration, DeviceGrant } from '@/lib/agent/devices/store'
import type { NuphosTeamRole } from '@/lib/identity/types'
import type { AuthVariables } from '@/middleware/auth'
import type { AgentDeviceRouteDependencies } from '@/routes/agent/routes-devices'

let upserted: { userId: string; device: AgentDeviceRegistration }[]
let devices: Record<string, AgentDevice>
let auditEntries: DeviceExecAuditEntry[]
let auditQueries: {
  ownerUserId: string
  deviceId: string
  limit: number
  cursor?: string
  includeUnfinished?: boolean
}[]
let issued: { userId: string; options: { label?: string; expiresInSec?: number } }[]
let credentials: Set<string>
let disconnected: string[]
let role: NuphosTeamRole | null
let revoked: { deviceIds: string[]; actorIds: string[] }[]
let metricsReads: string[]
let onlineNow = false
const members = [
  { id: 'user-1', role: 'ADMINISTRATOR' },
  { id: 'alice', role: 'EDITOR' },
  { id: 'bob', role: 'EDITOR' },
]

function key(userId: string, deviceId: string): string {
  return `${userId}:${deviceId}`
}

type ShareRow = Record<string, unknown>
/** What each share collection holds, by collection name. */
const shareTables: Record<string, ShareRow[]> = {
  agent_device_share_approvals: [],
  agent_device_share_trusts: [],
}

/** Serves the two collections a delete forgets share state in; nothing else in
 *  this suite reads the database. */
useDb({
  db: () => ({
    collection: (name: string) => {
      const rows = shareTables[name]

      if (!rows) return {}

      return {
        deleteMany: async (filter: ShareRow) => {
          const kept = rows.filter((row) =>
            Object.entries(filter).some(([field, value]) => row[field] !== value),
          )
          const deletedCount = rows.length - kept.length

          rows.length = 0
          rows.push(...kept)

          return { deletedCount }
        },
      }
    },
  }),
})

type BoxDeps = NonNullable<AgentDeviceRouteDependencies['box']>

function buildApp(box: BoxDeps | null = null) {
  const app = new Hono<{ Variables: AuthVariables }>()

  app.use('*', async (c, next) => {
    c.set('userId', 'user-1')
    await next()
  })
  app.route(
    '/agent',
    createAgentDeviceRoutes({
      access: {
        getDevice: async (owner, id) => devices[key(owner, id)] ?? null,
        listDevices: async (owner) => Object.values(devices).filter((d) => d.userId === owner),
        listBoxes: async (team) => Object.values(devices).filter((d) => d.box?.teamId === team),
        listGranted: () => Promise.resolve([]),
        findGranted: () => Promise.resolve([]),
        role: async (_actor, team) => (team === 'team-1' ? role : null),
      },
      setTeamUse: async (userId, deviceId, teamId, use) => {
        const device = devices[key(userId, deviceId)]
        const managerIds = device?.access?.find((g) => g.teamId === teamId)?.managerIds ?? []

        if (device) device.access = [{ teamId, ...use, managerIds }]

        return Boolean(device)
      },
      readMetrics: async (owner, deviceId, demand) => {
        metricsReads.push(`${owner}:${deviceId}:${String(demand)}`)

        return { metrics: null, metricsStatus: 'waiting', metricsReceivedAt: null }
      },
      teamMembers: async (team) => (team === 'team-1' ? members : []),
      revokeStreams: async (targets, actorIds) => {
        revoked.push({ deviceIds: targets.map((d) => d.deviceId), actorIds })
      },
      upsertAgentDevice: async (userId, device) => {
        upserted.push({ userId, device })
        devices[key(userId, device.deviceId)] = {
          userId,
          ...device,
          createdAt: new Date(),
          updatedAt: new Date(),
        }
      },
      getAgentDevice: async (userId, deviceId) => devices[key(userId, deviceId)] ?? null,
      listDevices: async (userId) => Object.values(devices).filter((d) => d.userId === userId),
      isOnline: async () => onlineNow,
      deleteDevice: async (userId, deviceId) => delete devices[key(userId, deviceId)],
      forgetDeviceShares,
      renameDevice: async (userId, deviceId, label) => {
        const device = devices[key(userId, deviceId)]

        if (device) device.label = label

        return device !== undefined
      },
      publicUrl: () => 'https://nuphos.example',
      box,
      listDeviceExecAudit: async (ownerUserId, deviceId, options) => {
        auditQueries.push({ ownerUserId, deviceId, ...options })
        const entries = auditEntries.filter(
          (entry) =>
            entry.ownerUserId === ownerUserId &&
            entry.deviceId === deviceId &&
            (options.includeUnfinished || entry.outcome !== 'unknown'),
        )

        return {
          entries: entries.slice(0, options.limit),
          nextCursor:
            entries.length > options.limit
              ? (entries[options.limit - 1]?.requestedAt.toISOString() ?? null)
              : null,
        }
      },
      conversationTitlesFor: async (sessionIds) =>
        new Map(sessionIds.map((id) => [id, `Title ${id}`])),
      boxDesktops: async (owner, deviceId, viewer, team) => [
        { display: 2, sessionId: `${owner}:${deviceId}:${viewer}:${String(team)}`, title: 'Fix' },
      ],
      issueJoinToken: async (userId, options) => {
        issued.push({ userId, options })

        return { token: 'nbj_test', expiresAt: new Date('2026-10-14T12:15:00Z') }
      },
      revokeCredential: async (userId, deviceId) => credentials.delete(key(userId, deviceId)),
      disconnect: async (userId, deviceId) => {
        disconnected.push(key(userId, deviceId))
      },
    }),
  )
  app.onError(errorHandler)

  return app
}

beforeEach(() => {
  role = 'ADMINISTRATOR'
  upserted = []
  devices = {}
  auditEntries = []
  auditQueries = []
  issued = []
  credentials = new Set()
  disconnected = []
  revoked = []
  metricsReads = []
  onlineNow = false
  shareTables.agent_device_share_approvals = []
  shareTables.agent_device_share_trusts = []
})

function auditEntry(overrides: Partial<DeviceExecAuditEntry>): DeviceExecAuditEntry {
  return {
    ownerUserId: 'user-1',
    deviceId: 'd1',
    actorUserId: 'user-1',
    conversationOwnerUserId: 'user-1',
    origin: 'user',
    teamId: 'team-1',
    sessionId: 's1',
    command: 'ls',
    commandRedacted: false,
    requestedAt: new Date('2026-09-01T00:00:00Z'),
    dispatchedAt: new Date('2026-09-01T00:00:00Z'),
    finishedAt: new Date('2026-09-01T00:00:01Z'),
    durationMs: 1000,
    outcome: 'ok',
    exitCode: 0,
    ...overrides,
  }
}

function registerDevice(userId: string, deviceId: string) {
  devices[key(userId, deviceId)] = {
    userId,
    deviceId,
    label: 'MacBook',
    platform: 'darwin',
    allowLocalExec: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  }
}

describe('agent device routes', () => {
  test('DELETE /agent/devices/:id removes an offline computer of the caller only', async () => {
    const remove = (deviceId: string) =>
      buildApp().request(`/agent/devices/${deviceId}?teamId=team-1`, { method: 'DELETE' })

    registerDevice('user-1', 'gone')
    registerDevice('user-1', 'live')
    registerDevice('user-1', 'b1')
    devices[key('user-1', 'b1')]!.box = { provider: 'instabox', teamId: 'team-1' }
    registerDevice('someone-else', 'theirs')

    expect((await remove('gone')).status).toBe(200)
    expect(devices[key('user-1', 'gone')]).toBeUndefined()
    expect(disconnected).toEqual([key('user-1', 'gone')])
    expect((await remove('b1')).status).toBe(400)
    expect((await remove('theirs')).status).toBe(404)
    onlineNow = true
    const online = await remove('live')

    expect(online.status).toBe(409)
    expect(await online.json()).toMatchObject({ error: { code: 'device_online' } })
    expect(new Set(Object.keys(devices))).toEqual(
      new Set([key('user-1', 'live'), key('user-1', 'b1'), key('someone-else', 'theirs')]),
    )
  })

  test('DELETE /agent/devices/:id forgets the computer share answers in every team', async () => {
    const app = buildApp()
    const remove = (deviceId: string) =>
      app.request(`/agent/devices/${deviceId}?teamId=team-1`, { method: 'DELETE' })

    shareTables.agent_device_share_approvals = [
      { ownerId: 'user-1', deviceId: 'gone', teamId: 'team-1', actorId: 'alice' },
      { ownerId: 'user-1', deviceId: 'gone', teamId: 'team-2', actorId: 'bob' },
      { ownerId: 'user-1', deviceId: 'live', teamId: 'team-1', actorId: 'alice' },
      { ownerId: 'someone-else', deviceId: 'theirs', teamId: 'team-1', actorId: 'alice' },
    ]
    shareTables.agent_device_share_trusts = [
      { ownerId: 'user-1', deviceId: 'gone', teamId: 'team-1', actorId: 'alice' },
      { ownerId: 'user-1', deviceId: 'live', teamId: 'team-1', actorId: 'alice' },
    ]
    registerDevice('user-1', 'gone')
    registerDevice('user-1', 'live')
    registerDevice('someone-else', 'theirs')

    // Another person's computer is not the caller's to delete, and keeps its rows.
    expect((await remove('theirs')).status).toBe(404)
    expect((await remove('gone')).status).toBe(200)
    expect(shareTables.agent_device_share_approvals).toEqual([
      { ownerId: 'user-1', deviceId: 'live', teamId: 'team-1', actorId: 'alice' },
      { ownerId: 'someone-else', deviceId: 'theirs', teamId: 'team-1', actorId: 'alice' },
    ])
    expect(shareTables.agent_device_share_trusts).toEqual([
      { ownerId: 'user-1', deviceId: 'live', teamId: 'team-1', actorId: 'alice' },
    ])
    // Nuphos there registers the machine again under the id it keeps, and its
    // owner's answers are not waiting for it when it does.
    const again = await app.request('/agent/devices', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        deviceId: 'gone',
        label: 'MacBook',
        platform: 'darwin',
        allowLocalExec: true,
      }),
    })

    expect(again.status).toBe(200)
    expect(devices[key('user-1', 'gone')]).toBeDefined()
    expect(shareTables.agent_device_share_approvals).toHaveLength(2)
    expect(shareTables.agent_device_share_trusts).toHaveLength(1)
  })

  test('PUT /agent/devices upserts for the signed-in user', async () => {
    const app = buildApp()
    const response = await app.request('/agent/devices', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        deviceId: 'd1',
        label: 'MacBook',
        platform: 'darwin',
        allowLocalExec: true,
      }),
    })

    expect(response.status).toBe(200)
    expect(upserted).toEqual([
      {
        userId: 'user-1',
        device: { deviceId: 'd1', label: 'MacBook', platform: 'darwin', allowLocalExec: true },
      },
    ])
  })

  test('PUT /agent/devices rejects a malformed body', async () => {
    const app = buildApp()
    const response = await app.request('/agent/devices', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ deviceId: '', label: 'x', platform: 'darwin', allowLocalExec: true }),
    })

    expect(response.status).toBe(400)
    expect(upserted).toEqual([])
  })

  test('GET .../audit passes the before cursor through', async () => {
    registerDevice('user-1', 'd1')

    const app = buildApp()
    const response = await app.request(
      '/agent/devices/d1/audit?before=2026-09-01T00:00:00.000Z_65f000000000000000000001',
    )

    expect(response.status).toBe(200)
    expect(auditQueries).toEqual([
      {
        ownerUserId: 'user-1',
        deviceId: 'd1',
        limit: 20,
        cursor: '2026-09-01T00:00:00.000Z_65f000000000000000000001',
      },
    ])
  })

  test('GET .../audit returns unfinished operations without inventing completion timestamps', async () => {
    registerDevice('user-1', 'd1')
    auditEntries = [auditEntry({ outcome: 'unknown', finishedAt: null, durationMs: null })]
    const response = await buildApp().request('/agent/devices/d1/audit?includeUnfinished=true')

    expect(response.status).toBe(200)
    const body = (await response.json()) as { entries: Record<string, unknown>[] }

    expect(body.entries[0]).toMatchObject({
      outcome: 'unknown',
      finishedAt: null,
      durationMs: null,
    })
  })

  test('GET .../audit keeps unfinished records out of legacy client responses', async () => {
    registerDevice('user-1', 'd1')
    auditEntries = [auditEntry({ outcome: 'unknown', finishedAt: null, durationMs: null })]
    const response = await buildApp().request('/agent/devices/d1/audit')

    expect(response.status).toBe(200)
    const body = (await response.json()) as { entries: unknown[] }

    expect(body.entries).toEqual([])
  })

  test('GET .../audit rejects an undecodable cursor instead of restarting at page one', async () => {
    registerDevice('user-1', 'd1')

    const app = buildApp()
    const response = await app.request('/agent/devices/d1/audit?before=2026-09-01T00:00:00.000Z')

    expect(response.status).toBe(400)
    expect(auditQueries).toEqual([])
  })

  test('GET .../audit 404s for a device the caller does not own', async () => {
    registerDevice('user-2', 'd1')
    auditEntries = [auditEntry({ ownerUserId: 'user-2' })]

    const app = buildApp()
    const response = await app.request('/agent/devices/d1/audit')

    expect(response.status).toBe(404)
    expect(auditQueries).toEqual([])
  })

  test('POST /devices/join-tokens issues a token for the caller with a 15 minute default', async () => {
    const response = await buildApp().request('/agent/devices/join-tokens', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ label: 'build box' }),
    })

    expect(response.status).toBe(201)
    expect(await response.json()).toEqual({
      token: 'nbj_test',
      expiresAt: '2026-10-14T12:15:00.000Z',
      apiUrl: 'https://nuphos.example',
    })
    expect(issued).toEqual([
      { userId: 'user-1', options: { label: 'build box', expiresInSec: 900 } },
    ])
  })

  test('POST /devices/join-tokens caps the lifetime at a day', async () => {
    const response = await buildApp().request('/agent/devices/join-tokens', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ expiresInSec: 86_401 }),
    })

    expect(response.status).toBe(400)
    expect(issued).toEqual([])
  })

  test('DELETE .../credential revokes the caller own device and drops its tunnel', async () => {
    registerDevice('user-1', 'd1')
    credentials.add(key('user-1', 'd1'))
    const response = await buildApp().request('/agent/devices/d1/credential', { method: 'DELETE' })

    expect(response.status).toBe(200)
    expect(disconnected).toEqual([key('user-1', 'd1')])
  })

  test('DELETE .../credential 404s without touching another user tunnel', async () => {
    credentials.add(key('user-2', 'd1'))
    const response = await buildApp().request('/agent/devices/d1/credential', { method: 'DELETE' })

    expect(response.status).toBe(404)
    expect(disconnected).toEqual([])
    expect(credentials.has(key('user-2', 'd1'))).toBe(true)
  })

  /** A cloud computer in team-1; by default user-1 manages it, as migrated admins do. */
  function boxDevice(userId: string, deviceId: string, grant: Partial<DeviceGrant> = {}) {
    return {
      userId,
      deviceId,
      label: 'Box',
      platform: 'linux',
      allowLocalExec: true,
      box: { provider: 'instabox' as const, sandboxId: `m_${deviceId}`, teamId: 'team-1' },
      access: [
        {
          teamId: 'team-1',
          everyone: false,
          userIds: [] as string[],
          managerIds: userId === 'user-1' ? [] : ['user-1'],
          ...grant,
        },
      ],
      createdAt: new Date(),
      updatedAt: new Date(),
    }
  }

  let machineState: 'running' | 'paused' = 'paused'

  function fakeBox(calls: string[]): BoxDeps {
    return {
      create: async (userId, teamId, label, options) => {
        calls.push(`create ${teamId} ${label}`)
        const device = boxDevice(userId, 'b1')

        devices[key(userId, 'b1')] = {
          ...device,
          label,
          access: [{ teamId, everyone: false, userIds: [], managerIds: [], ...options?.shared }],
        }

        return devices[key(userId, 'b1')]!
      },
      pause: async (userId, deviceId) => {
        calls.push(`pause ${deviceId}`)
        machineState = 'paused'

        return boxDevice(userId, deviceId)
      },
      resume: async (userId, deviceId) => {
        calls.push(`resume ${deviceId}`)
        machineState = 'running'

        return boxDevice(userId, deviceId)
      },
      destroy: async (_userId, deviceId) => {
        calls.push(`destroy ${deviceId}`)
      },
      size: async (_userId, deviceId) => {
        calls.push(`size ${deviceId}`)

        return { vcpus: 2, memMiB: 4096, diskGiB: 20, running: true, sizes: [], maxDiskGiB: 1024 }
      },
      resize: async (userId, deviceId, requested) => {
        calls.push(`resize ${deviceId} ${JSON.stringify(requested)}`)
        const device = devices[key(userId, deviceId)]!

        device.box = { ...device.box!, resize: { startedAt: new Date() } }

        return device
      },
      desktop: async (_userId, deviceId) => `https://desktop.example/${deviceId}`,
      heal: (_userId, deviceId) => {
        calls.push(`heal ${deviceId}`)
      },
      available: () => true,
      state: async (device, online) =>
        !device.box?.sandboxId ? 'creating' : online ? 'running' : machineState,
    }
  }

  test('PUT /agent/devices never rewrites a Box row, even for its creator', async () => {
    devices[key('user-1', 'b1')] = boxDevice('user-1', 'b1')
    const response = await buildApp().request('/agent/devices', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        deviceId: 'b1',
        label: 'x',
        platform: 'darwin',
        allowLocalExec: true,
      }),
    })

    expect(response.status).toBe(409)
    expect(upserted).toEqual([])
    expect(devices[key('user-1', 'b1')]?.platform).toBe('linux')
  })

  test('GET /devices lists the caller devices with their Box state and never the credential', async () => {
    devices[key('user-1', 'b1')] = {
      ...boxDevice('user-1', 'b1'),
      credentialHash: 'secret-hash',
    }
    devices[key('user-2', 'b2')] = boxDevice('user-2', 'b2')
    const response = await buildApp(fakeBox([])).request('/agent/devices?teamId=team-1')
    const body = (await response.json()) as {
      boxAvailable: boolean
      devices: Record<string, unknown>[]
    }

    expect(response.status).toBe(200)
    expect(body.boxAvailable).toBe(true)
    expect(body.devices).toHaveLength(2)
    expect(body.devices[0]).toMatchObject({
      deviceId: 'b1',
      online: false,
      access: 'owner',
      ownerUserId: 'user-1',
      box: { state: 'paused' },
    })
    // A manager is told so, and who owns it.
    expect(body.devices[1]).toMatchObject({ access: 'manage', ownerUserId: 'user-2' })
    expect(JSON.stringify(body)).not.toContain('secret-hash')
    const plain = (await (await buildApp().request('/agent/devices?teamId=team-1')).json()) as {
      boxAvailable: boolean
    }

    expect(plain.boxAvailable).toBe(false)
  })

  test("GET /devices gives an online Box the viewer's session displays; an offline one none", async () => {
    devices[key('user-1', 'b1')] = boxDevice('user-1', 'b1')
    const list = async () =>
      (await (await buildApp(fakeBox([])).request('/agent/devices?teamId=team-1')).json()) as {
        devices: { desktops?: unknown }[]
      }

    expect((await list()).devices[0]?.desktops).toBeUndefined()
    onlineNow = true
    expect((await list()).devices[0]?.desktops).toEqual([
      { display: 2, sessionId: 'user-1:b1:user-1:team-1', title: 'Fix' },
    ])
  })

  test('an unnamed Box counts up from the highest "Computer N" the caller has', () => {
    expect(nextBoxLabel([])).toBe('Computer 1')
    expect(nextBoxLabel(['Computer 3', 'Build box', 'Computer 1'])).toBe('Computer 4')
    expect(nextBoxLabel(['Computer 10'])).toBe('Computer 11')
  })

  test('PATCH /devices/:deviceId renames the caller device and only theirs', async () => {
    devices[key('user-1', 'b1')] = boxDevice('user-1', 'b1')
    devices[key('user-2', 'b2')] = boxDevice('user-2', 'b2')
    const app = buildApp(fakeBox([]))
    const renamed = await app.request('/agent/devices/b1?teamId=team-1', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ label: 'Build box' }),
    })

    expect(renamed.status).toBe(200)
    expect(devices[key('user-1', 'b1')]?.label).toBe('Build box')
    const other = await app.request('/agent/devices/b2?teamId=team-other', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ label: 'Mine now' }),
    })

    expect(other.status).toBe(404)
    expect(devices[key('user-2', 'b2')]?.label).toBe('Box')
  })

  test('listing a running offline Box never heals or restarts its host', async () => {
    const calls: string[] = []

    machineState = 'running'
    devices[key('user-1', 'b1')] = { ...boxDevice('user-1', 'b1'), credentialHash: 'h' }
    devices[key('user-1', 'b3')] = boxDevice('user-1', 'b3')
    await buildApp(fakeBox(calls)).request('/agent/devices?teamId=team-1')
    // b3 never joined: nothing to restart there.
    expect(calls).toEqual([])
  })

  test('POST /devices/boxes is 503 without a Box provider', async () => {
    const response = await buildApp().request('/agent/devices/boxes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    })

    expect(response.status).toBe(503)
  })

  test('POST /devices/boxes needs a team the caller belongs to', async () => {
    const calls: string[] = []
    const response = await buildApp(fakeBox(calls)).request('/agent/devices/boxes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ label: 'Build box' }),
    })

    expect(response.status).toBe(400)
    expect(calls).toEqual([])
  })

  test('Box pause, resume and delete go through the provider for the caller device', async () => {
    const calls: string[] = []
    const app = buildApp(fakeBox(calls))

    devices[key('user-1', 'b1')] = boxDevice('user-1', 'b1')
    credentials.add(key('user-1', 'b1'))
    const paused = await app.request('/agent/devices/b1/box/pause?teamId=team-1', {
      method: 'POST',
    })

    expect(paused.status).toBe(200)
    expect(await paused.json()).toMatchObject({ deviceId: 'b1', box: { state: 'paused' } })
    const resumed = await app.request('/agent/devices/b1/box/resume?teamId=team-1', {
      method: 'POST',
    })

    expect(await resumed.json()).toMatchObject({ box: { state: 'running' } })
    const removed = await app.request('/agent/devices/b1/box?teamId=team-1', { method: 'DELETE' })

    expect(removed.status).toBe(200)
    expect(calls).toEqual(['pause b1', 'resume b1', 'destroy b1'])
    expect(disconnected).toEqual([key('user-1', 'b1')])
    expect(devices[key('user-1', 'b1')]).toBeUndefined()
  })

  test('a Box’s manager reads its size and resizes it; the view says it is resizing', async () => {
    const calls: string[] = []
    const app = buildApp(fakeBox(calls))
    const post = (body: unknown) =>
      app.request('/agent/devices/b1/box/resize?teamId=team-1', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })

    devices[key('host-owner', 'b1')] = boxDevice('host-owner', 'b1', { managerIds: ['user-1'] })
    role = 'EDITOR'
    const size = await app.request('/agent/devices/b1/box/size?teamId=team-1')

    expect(await size.json()).toMatchObject({ vcpus: 2, diskGiB: 20 })
    expect((await post({})).status).toBe(400)
    expect((await post({ diskGiB: 4096 })).status).toBe(400)
    const resized = await post({ vcpus: 4, diskGiB: 50 })

    expect(resized.status).toBe(202)
    expect(await resized.json()).toMatchObject({ box: { resizeStartedAt: expect.any(String) } })
    expect(calls).toEqual(['size b1', 'resize b1 {"vcpus":4,"diskGiB":50}'])
  })

  test('someone who may only use a Box can neither read its size nor resize it', async () => {
    const calls: string[] = []
    const app = buildApp(fakeBox(calls))

    devices[key('host-owner', 'b1')] = boxDevice('host-owner', 'b1', {
      userIds: ['user-1'],
      managerIds: [],
    })
    role = 'EDITOR'
    expect((await app.request('/agent/devices/b1/box/size?teamId=team-1')).status).toBe(404)
    const resized = await app.request('/agent/devices/b1/box/resize?teamId=team-1', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ diskGiB: 50 }),
    })

    expect(resized.status).toBe(404)
    expect(calls).toEqual([])
  })

  test('why a resize failed is shown to those who manage the Box, not to those who use it', async () => {
    const base = boxDevice('host-owner', 'b1', { everyone: true, managerIds: [] })

    devices[key('host-owner', 'b1')] = {
      ...base,
      box: { ...base.box, resize: { error: 'Could not resize the Box: no room' } },
    }
    const app = buildApp(fakeBox([]))
    const box = async () =>
      (
        (await (await app.request('/agent/devices?teamId=team-1')).json()) as {
          devices: { box?: Record<string, unknown> }[]
        }
      ).devices[0]?.box

    role = 'EDITOR'
    expect((await box())?.resizeError).toBeUndefined()
    devices[key('host-owner', 'b1')]!.access![0]!.managerIds = ['user-1']
    expect(await box()).toMatchObject({ resizeError: 'Could not resize the Box: no room' })
  })

  test('DELETE closes the Box tunnel before its machine goes, and keeps the row if the kill fails', async () => {
    devices[key('user-1', 'b1')] = boxDevice('user-1', 'b1')
    credentials.add(key('user-1', 'b1'))
    const seen: string[] = []
    let killFails = true
    const box: BoxDeps = {
      ...fakeBox([]),
      destroy: async () => {
        seen.push(`destroy after ${disconnected.length} disconnect(s)`)
        if (killFails) throw new Error('instabox is down')
      },
    }
    const app = buildApp(box)

    expect(
      (await app.request('/agent/devices/b1/box?teamId=team-1', { method: 'DELETE' })).status,
    ).not.toBe(200)
    expect(seen).toEqual(['destroy after 1 disconnect(s)'])
    expect(credentials.has(key('user-1', 'b1'))).toBe(false)
    expect(devices[key('user-1', 'b1')]).toBeDefined()
    killFails = false
    expect(
      (await app.request('/agent/devices/b1/box?teamId=team-1', { method: 'DELETE' })).status,
    ).toBe(200)
    expect(devices[key('user-1', 'b1')]).toBeUndefined()
  })
  test('Box routes deny someone with use only, removed members and cross-team calls before provider dispatch', async () => {
    const calls: string[] = []
    const target = boxDevice('host-owner', 'b1', { userIds: ['user-1'], managerIds: [] })

    devices[key('host-owner', 'b1')] = target
    const app = buildApp(fakeBox(calls))

    for (const currentRole of ['ADMINISTRATOR', null] as const) {
      role = currentRole
      for (const action of ['pause', 'resume', 'desktop']) {
        const result = await app.request(`/agent/devices/b1/box/${action}?teamId=team-1`, {
          method: 'POST',
        })

        expect(result.status).toBe(404)
      }
      expect(
        (await app.request('/agent/devices/b1/box?teamId=team-1', { method: 'DELETE' })).status,
      ).toBe(404)
    }
    // A manager may pause it, but deleting it is its owner's.
    role = 'EDITOR'
    target.access[0]!.managerIds = ['user-1']
    expect(
      (await app.request('/agent/devices/b1/box?teamId=team-1', { method: 'DELETE' })).status,
    ).toBe(404)
    expect(
      (await app.request('/agent/devices/b1/box/pause?teamId=team-2', { method: 'POST' })).status,
    ).toBe(404)
    expect(calls).toEqual([])
    expect(devices[key('host-owner', 'b1')]).toBe(target)
  })

  test('only the Box’s owner and managers set its access; those who lose it have their streams closed', async () => {
    const target = boxDevice('host-owner', 'b1', { everyone: true, managerIds: [] })

    devices[key('host-owner', 'b1')] = target
    const app = buildApp(fakeBox([]))
    const put = (body: unknown, team = 'team-1') =>
      app.request(`/agent/devices/b1/box/access?teamId=${team}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })

    // Team administrators get nothing implicit; someone who left gets nothing at all.
    for (const currentRole of ['ADMINISTRATOR', null] as const) {
      role = currentRole
      expect((await put({ everyone: false, userIds: ['alice'] })).status).toBe(404)
    }
    role = 'EDITOR'
    target.access[0]!.managerIds = ['user-1']
    expect((await put({ everyone: false, userIds: ['alice'] }, 'team-2')).status).toBe(404)
    expect(revoked).toEqual([])

    // A non-member (someone who left, or another team's user) is dropped, not stored.
    const ok = await put({ everyone: false, userIds: ['alice', 'alice', 'outsider'] })

    expect(ok.status).toBe(200)
    expect(devices[key('host-owner', 'b1')]?.access).toEqual([
      { teamId: 'team-1', everyone: false, userIds: ['alice'], managerIds: ['user-1'] },
    ])
    // Bob lost access; Alice kept it and the manager never depended on the list.
    expect(revoked).toEqual([{ deviceIds: ['b1'], actorIds: ['bob'] }])
  })

  test('the device list tells each viewer their level, and only managers see the access list', async () => {
    const target = boxDevice('host-owner', 'b1', { everyone: true })

    devices[key('host-owner', 'b1')] = target
    const app = buildApp(fakeBox([]))
    const list = async () =>
      (await (await app.request('/agent/devices?teamId=team-1')).json()) as {
        canCreateBox: boolean
        devices: { access: string; box?: { access?: unknown } }[]
      }

    machineState = 'running'
    const admin = await list()

    expect(admin.canCreateBox).toBe(true)
    expect(admin.devices[0]).toMatchObject({
      access: 'manage',
      ownerUserId: 'host-owner',
      box: { access: { everyone: true } },
    })
    role = 'EDITOR'
    target.access[0]!.managerIds = []
    const member = await list()

    expect(member.canCreateBox).toBe(false)
    expect(member.devices[0]?.access).toBe('use')
    expect(member.devices[0]?.box?.access).toBeUndefined()
  })

  test('only managers see when and from where a machine was last online', async () => {
    const target = {
      ...boxDevice('host-owner', 'b1', { everyone: true }),
      lastSeenAt: new Date('2026-10-16T12:00:00Z'),
      lastSeen: { ip: '203.0.113.7', city: 'Taipei', country: 'TW' },
    }

    devices[key('host-owner', 'b1')] = target
    const app = buildApp(fakeBox([]))
    const list = async () =>
      (
        (await (await app.request('/agent/devices?teamId=team-1')).json()) as {
          devices: Record<string, unknown>[]
        }
      ).devices[0]

    machineState = 'running'
    expect(await list()).toMatchObject({
      lastSeenAt: '2026-10-16T12:00:00.000Z',
      lastSeen: { ip: '203.0.113.7', city: 'Taipei', country: 'TW' },
    })
    target.access[0]!.managerIds = []
    const member = await list()

    expect(member?.lastSeenAt).toBeUndefined()
    expect(JSON.stringify(member)).not.toContain('203.0.113.7')
  })

  test('every viewer sees a Box whose host is restarting for an update, until it reports in again', async () => {
    const startedAt = new Date(Date.now() - 60_000)

    const base = boxDevice('host-owner', 'b1', { everyone: true, managerIds: [] })

    devices[key('host-owner', 'b1')] = {
      ...base,
      box: { ...base.box, updateStartedAt: startedAt },
      lastSeenAt: new Date(startedAt.getTime() - 60_000),
    }
    const app = buildApp(fakeBox([]))
    const box = async () =>
      (
        (await (await app.request('/agent/devices?teamId=team-1')).json()) as {
          devices: { box?: Record<string, unknown> }[]
        }
      ).devices[0]?.box

    machineState = 'running'
    role = 'EDITOR'
    expect(await box()).toMatchObject({ updateStartedAt: startedAt.toISOString() })
    // The host reported in after the update started: it is back.
    devices[key('host-owner', 'b1')]!.lastSeenAt = new Date()
    expect((await box())?.updateStartedAt).toBeUndefined()
  })

  test('metrics are read and demanded only for Boxes the viewer may use, under the transport owner', async () => {
    const box = (deviceId: string, userIds: string[]) =>
      boxDevice('host-owner', deviceId, { userIds, managerIds: [] })

    devices[key('host-owner', 'mine')] = box('mine', ['user-1'])
    devices[key('host-owner', 'theirs')] = box('theirs', ['alice'])
    onlineNow = true
    machineState = 'running'
    role = 'EDITOR'
    const app = buildApp(fakeBox([]))

    await app.request('/agent/devices?teamId=team-1&metrics=true')
    // Another team, or a removed member, demands nothing.
    await app.request('/agent/devices?teamId=team-2&metrics=true')
    role = null
    await app.request('/agent/devices?teamId=team-1&metrics=true')

    expect(metricsReads).toEqual(['host-owner:mine:true'])
  })

  test('admin dispatch uses the Box transport owner, never the viewing admin', async () => {
    devices[key('host-owner', 'b1')] = boxDevice('host-owner', 'b1')
    const owners: string[] = []
    const provider = fakeBox([])

    provider.pause = async (owner, id) => {
      owners.push(owner)

      return devices[key(owner, id)]!
    }
    const result = await buildApp(provider).request('/agent/devices/b1/box/pause?teamId=team-1', {
      method: 'POST',
    })

    expect(result.status).toBe(200)
    expect(owners).toEqual(['host-owner'])
  })

  test('list omits Boxes the viewer has no grant on, missing-team rows and removed viewers', async () => {
    role = 'EDITOR'
    const target = boxDevice('host-owner', 'b1', { userIds: ['user-1'], managerIds: [] })

    devices[key('host-owner', 'b1')] = target
    const app = buildApp(fakeBox([]))
    const list = async () =>
      (await (await app.request('/agent/devices?teamId=team-1')).json()) as { devices: unknown[] }

    expect((await list()).devices).toHaveLength(1)
    target.access[0]!.userIds = []
    expect((await list()).devices).toHaveLength(0)
    // An administrator role alone shows nothing.
    role = 'ADMINISTRATOR'
    expect((await list()).devices).toHaveLength(0)
    target.access[0]!.userIds = ['user-1']
    target.box.teamId = ''
    expect((await list()).devices).toHaveLength(0)
    target.box.teamId = 'team-1'
    role = null
    expect((await list()).devices).toHaveLength(0)
  })
  test('Box create rejects ordinary members, removed admins and admins of other teams', async () => {
    const calls: string[] = []
    const app = buildApp(fakeBox(calls))
    const create = (teamId: string) =>
      app.request('/agent/devices/boxes', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ teamId }),
      })

    role = 'EDITOR'
    expect((await create('team-1')).status).toBe(403)
    role = null
    expect((await create('team-1')).status).toBe(403)
    role = 'ADMINISTRATOR'
    expect((await create('team-2')).status).toBe(403)
    expect(calls).toEqual([])
    expect((await create('team-1')).status).toBe(201)
    expect(calls).toHaveLength(1)
  })
  test('Box create passes the requested access, limited to current team members, to the provider', async () => {
    const calls: string[] = []
    const app = buildApp(fakeBox(calls))
    const create = (access?: { everyone: boolean; userIds: string[] }) =>
      app.request('/agent/devices/boxes', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ teamId: 'team-1', label: 'Shared box', vcpus: 4, access }),
      })
    const response = await create({ everyone: false, userIds: ['alice', 'alice', 'stranger'] })

    expect(response.status).toBe(201)
    expect(calls).toEqual(['create team-1 Shared box'])
    expect(await response.json()).toMatchObject({
      label: 'Shared box',
      box: { access: { everyone: false, userIds: ['alice'] } },
    })
    expect(await (await create({ everyone: true, userIds: [] })).json()).toMatchObject({
      box: { access: { everyone: true, userIds: [] } },
    })
    // Without a request, nobody but its owner uses it.
    const plain = (await (await create()).json()) as { box: { access?: unknown } }

    expect(plain.box.access).toEqual({ everyone: false, userIds: [] })
  })
})
