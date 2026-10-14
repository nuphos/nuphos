import { beforeEach, describe, expect, test } from 'bun:test'
import { Hono } from 'hono'

import { errorHandler } from '@/lib/errors'
import { createAgentDeviceRoutes } from '@/routes/agent/routes-devices'

import type { DeviceExecAuditEntry } from '@/lib/agent/devices/audit'
import type { AgentDeviceRegistration, AgentDevice } from '@/lib/agent/devices/store'
import type { AuthVariables } from '@/middleware/auth'

let upserted: { userId: string; device: AgentDeviceRegistration }[]
let devices: Record<string, AgentDevice>
let auditEntries: DeviceExecAuditEntry[]
let auditQueries: { ownerUserId: string; deviceId: string; limit: number; cursor?: string }[]
let issued: { userId: string; options: { label?: string; expiresInSec?: number } }[]
let credentials: Set<string>
let disconnected: string[]

function key(userId: string, deviceId: string): string {
  return `${userId}:${deviceId}`
}

function buildApp() {
  const app = new Hono<{ Variables: AuthVariables }>()

  app.use('*', async (c, next) => {
    c.set('userId', 'user-1')
    await next()
  })
  app.route(
    '/agent',
    createAgentDeviceRoutes({
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
  upserted = []
  devices = {}
  auditEntries = []
  auditQueries = []
  issued = []
  credentials = new Set()
  disconnected = []
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
})
