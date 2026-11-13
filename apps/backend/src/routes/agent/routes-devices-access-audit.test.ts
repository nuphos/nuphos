import { beforeEach, describe, expect, test } from 'bun:test'
import { Hono } from 'hono'

import { errorHandler } from '@/lib/errors'
import { createDeviceAccessAuditRoutes } from '@/routes/agent/routes-devices-access-audit'

import type { DeviceAccessAuditEntry } from '@/lib/agent/devices/access-audit'
import type { AgentDevice, DeviceGrant } from '@/lib/agent/devices/store'
import type { AuthVariables } from '@/middleware/auth'

let devices: AgentDevice[]
let queries: unknown[]

function buildApp() {
  const app = new Hono<{ Variables: AuthVariables }>()

  app.use('*', async (c, next) => {
    c.set('userId', 'user-1')
    await next()
  })
  app.route(
    '/agent',
    createDeviceAccessAuditRoutes({
      access: {
        getDevice: (owner, id) =>
          Promise.resolve(devices.find((d) => d.userId === owner && d.deviceId === id) ?? null),
        listDevices: (owner) => Promise.resolve(devices.filter((d) => d.userId === owner)),
        listBoxes: (team) => Promise.resolve(devices.filter((d) => d.box?.teamId === team)),
        listGranted: () => Promise.resolve([]),
        findGranted: () => Promise.resolve([]),
        // The caller administers team-1 and is no member of any other team.
        role: (_actor, team) => Promise.resolve(team === 'team-1' ? 'ADMINISTRATOR' : null),
      },
      listDeviceAccessAudit: (scope, options) => {
        queries.push({ scope, options })
        const entry: DeviceAccessAuditEntry = {
          ...scope,
          actorUserId: 'boss',
          actorAuthority: 'owner',
          via: 'share',
          previous: null,
          next: { everyone: true, userIds: [], managerIds: [] },
          changedAt: new Date('2026-11-01T00:00:00Z'),
        }

        return Promise.resolve({ entries: [entry], nextCursor: null })
      },
    }),
  )
  app.onError(errorHandler)

  return app
}

const read = (deviceId: string, query = 'teamId=team-1') =>
  buildApp().request(`/agent/devices/${deviceId}/access-audit?${query}`)

function computer(userId: string, deviceId: string): AgentDevice {
  return {
    userId,
    deviceId,
    label: 'MacBook',
    platform: 'darwin',
    allowLocalExec: true,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  }
}

/** A team-1 Box someone else made, with this grant for the caller. */
function teamBox(grant: Partial<DeviceGrant>): AgentDevice {
  return {
    ...computer('host', 'b1'),
    box: { provider: 'instabox', teamId: 'team-1', createdBy: 'boss' },
    access: [{ teamId: 'team-1', everyone: false, userIds: [], managerIds: [], ...grant }],
  }
}

beforeEach(() => {
  devices = []
  queries = []
})

describe('GET /agent/devices/:deviceId/access-audit', () => {
  test('the owner reads their computer’s changes in the team asked, with paging and a time range', async () => {
    devices = [computer('user-1', 'd1')]
    const response = await read(
      'd1',
      'teamId=team-1&limit=5&since=2026-10-01T00:00:00Z&until=2026-11-02T00:00:00Z&before=2026-11-01T00:00:00.000Z_65f000000000000000000001',
    )

    expect(response.status).toBe(200)
    expect(queries).toEqual([
      {
        scope: { ownerUserId: 'user-1', deviceId: 'd1', teamId: 'team-1' },
        options: {
          limit: 5,
          cursor: '2026-11-01T00:00:00.000Z_65f000000000000000000001',
          since: new Date('2026-10-01T00:00:00Z'),
          until: new Date('2026-11-02T00:00:00Z'),
        },
      },
    ])
    expect(await response.json()).toEqual({
      entries: [
        {
          id: null,
          deviceId: 'd1',
          teamId: 'team-1',
          actorUserId: 'boss',
          actorAuthority: 'owner',
          via: 'share',
          previous: null,
          next: { everyone: true, userIds: [], managerIds: [] },
          changedAt: '2026-11-01T00:00:00.000Z',
        },
      ],
      nextCursor: null,
    })
  })

  test('a manager reads a team computer they do not own, scoped to its stored owner', async () => {
    devices = [teamBox({ managerIds: ['user-1'] })]

    expect((await read('b1')).status).toBe(200)
    expect(queries).toEqual([
      { scope: { ownerUserId: 'host', deviceId: 'b1', teamId: 'team-1' }, options: { limit: 20 } },
    ])
  })

  test('using a computer is not enough, and neither is a team role', async () => {
    devices = [teamBox({ userIds: ['user-1'] })]
    expect((await read('b1')).status).toBe(404)
    // The caller administers the team; that grants nothing on a computer.
    devices = [teamBox({ everyone: true })]
    expect((await read('b1')).status).toBe(404)
    expect(queries).toEqual([])
  })

  test('other people’s computers, other teams and a missing team are refused before any query', async () => {
    devices = [computer('user-2', 'd2')]
    expect((await read('d2')).status).toBe(404)
    // Managing it in team-1 says nothing about team-2, where the caller is no member.
    devices = [teamBox({ managerIds: ['user-1'] })]
    expect((await read('b1', 'teamId=team-2')).status).toBe(404)
    devices = [computer('user-1', 'd1')]
    expect((await read('d1', '')).status).toBe(400)
    expect((await read('d1', 'teamId=team-1&since=yesterday')).status).toBe(400)
    expect((await read('d1', 'teamId=team-1&before=nope')).status).toBe(400)
    expect(queries).toEqual([])
  })
})
