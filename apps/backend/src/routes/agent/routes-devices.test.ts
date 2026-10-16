import { beforeEach, describe, expect, test } from 'bun:test'
import { Hono } from 'hono'

import { errorHandler } from '@/lib/errors'
import { createAgentDeviceRoutes } from '@/routes/agent/routes-devices'
import { nextBoxLabel } from '@/routes/agent/routes-devices-box'

import type { DeviceExecAuditEntry } from '@/lib/agent/devices/audit'
import type { AgentDeviceRegistration, AgentDevice } from '@/lib/agent/devices/store'
import type { NuphosTeamRole } from '@/lib/identity/types'
import type { AuthVariables } from '@/middleware/auth'
import type { AgentDeviceRouteDependencies } from '@/routes/agent/routes-devices'

let upserted: { userId: string; device: AgentDeviceRegistration }[]
let devices: Record<string, AgentDevice>
let auditEntries: DeviceExecAuditEntry[]
let auditQueries: { ownerUserId: string; deviceId: string; limit: number; cursor?: string }[]
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
        role: async (_actor, team) => (team === 'team-1' ? role : null),
      },
      setBoxAccess: async (userId, deviceId, access) => {
        const device = devices[key(userId, deviceId)]

        if (device?.box) device.box.access = access

        return Boolean(device?.box)
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
          (entry) => entry.ownerUserId === ownerUserId && entry.deviceId === deviceId,
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

  function boxDevice(userId: string, deviceId: string) {
    return {
      userId,
      deviceId,
      label: 'Box',
      platform: 'linux',
      allowLocalExec: true,
      box: { provider: 'instabox' as const, sandboxId: `m_${deviceId}`, teamId: 'team-1' },
      createdAt: new Date(),
      updatedAt: new Date(),
    }
  }

  let machineState: 'running' | 'paused' = 'paused'

  function fakeBox(calls: string[]): BoxDeps {
    return {
      create: async (userId, teamId, label) => {
        calls.push(`create ${teamId} ${label}`)
        devices[key(userId, 'b1')] = { ...boxDevice(userId, 'b1'), label }

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
      box: { state: 'paused' },
    })
    expect(JSON.stringify(body)).not.toContain('secret-hash')
    const plain = (await (await buildApp().request('/agent/devices?teamId=team-1')).json()) as {
      boxAvailable: boolean
    }

    expect(plain.boxAvailable).toBe(false)
  })

  test('an unnamed Box counts up from the highest "Box N" the caller has', () => {
    expect(nextBoxLabel([])).toBe('Box 1')
    expect(nextBoxLabel(['Box 3', 'Build box', 'Box 1'])).toBe('Box 4')
    expect(nextBoxLabel(['Box 10'])).toBe('Box 11')
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
  test('Box routes deny a creator with use only, removed admins and cross-team calls before provider dispatch', async () => {
    const calls: string[] = []
    const target = boxDevice('user-1', 'b1')

    devices[key('user-1', 'b1')] = target
    const app = buildApp(fakeBox(calls))

    for (const currentRole of ['EDITOR', null] as const) {
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
    role = 'ADMINISTRATOR'
    expect(
      (await app.request('/agent/devices/b1/box/pause?teamId=team-2', { method: 'POST' })).status,
    ).toBe(404)
    expect(calls).toEqual([])
    expect(devices[key('user-1', 'b1')]).toBe(target)
  })

  test('only an administrator of the Box’s team sets its access; those who lose it have their streams closed', async () => {
    devices[key('host-owner', 'b1')] = {
      ...boxDevice('host-owner', 'b1'),
      box: {
        provider: 'instabox',
        sandboxId: 'm_b1',
        teamId: 'team-1',
        access: { everyone: true, userIds: [] },
      },
    }
    const app = buildApp(fakeBox([]))
    const put = (body: unknown, team = 'team-1') =>
      app.request(`/agent/devices/b1/box/access?teamId=${team}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })

    for (const currentRole of ['EDITOR', null] as const) {
      role = currentRole
      expect((await put({ everyone: false, userIds: ['alice'] })).status).toBe(404)
    }
    role = 'ADMINISTRATOR'
    expect((await put({ everyone: false, userIds: ['alice'] }, 'team-2')).status).toBe(404)
    expect((await put({ everyone: false, userIds: ['outsider'] })).status).toBe(400)
    expect(devices[key('host-owner', 'b1')]?.box?.access).toEqual({ everyone: true, userIds: [] })
    expect(revoked).toEqual([])

    const ok = await put({ everyone: false, userIds: ['alice', 'alice'] })

    expect(ok.status).toBe(200)
    expect(devices[key('host-owner', 'b1')]?.box?.access).toEqual({
      everyone: false,
      userIds: ['alice'],
    })
    // Bob lost access; Alice kept it and the administrator never depended on the list.
    expect(revoked).toEqual([{ deviceIds: ['b1'], actorIds: ['bob'] }])
  })

  test('the device list tells each viewer their level, and only managers see the access list', async () => {
    devices[key('host-owner', 'b1')] = {
      ...boxDevice('host-owner', 'b1'),
      box: {
        provider: 'instabox',
        sandboxId: 'm_b1',
        teamId: 'team-1',
        access: { everyone: true, userIds: [] },
      },
    }
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
      box: { access: { everyone: true } },
    })
    role = 'EDITOR'
    const member = await list()

    expect(member.canCreateBox).toBe(false)
    expect(member.devices[0]?.access).toBe('use')
    expect(member.devices[0]?.box?.access).toBeUndefined()
  })

  test('metrics are read and demanded only for Boxes the viewer may use, under the transport owner', async () => {
    const box = (deviceId: string, userIds: string[]) => ({
      ...boxDevice('host-owner', deviceId),
      box: {
        provider: 'instabox' as const,
        sandboxId: `m_${deviceId}`,
        teamId: 'team-1',
        access: { everyone: false, userIds },
      },
    })

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

  test('list omits legacy Boxes from other creators, missing-team rows and revoked viewers', async () => {
    role = 'EDITOR'
    devices[key('host-owner', 'b1')] = boxDevice('host-owner', 'b1')
    const target = devices[key('host-owner', 'b1')]!

    target.box!.access = { everyone: false, userIds: ['user-1'] }
    const app = buildApp(fakeBox([]))
    const list = async () =>
      (await (await app.request('/agent/devices?teamId=team-1')).json()) as { devices: unknown[] }

    expect((await list()).devices).toHaveLength(1)
    target.box!.access.userIds = []
    expect((await list()).devices).toHaveLength(0)
    delete target.box!.access
    expect((await list()).devices).toHaveLength(0)
    role = 'ADMINISTRATOR'
    target.box!.teamId = ''
    expect((await list()).devices).toHaveLength(0)
    target.box!.teamId = 'team-1'
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
})
