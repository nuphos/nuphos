import { beforeEach, describe, expect, test } from 'bun:test'
import { Hono } from 'hono'
import { ObjectId } from 'mongodb'

import { AppError } from '@/lib/errors'
import { useDb } from '@/lib/test/doubles/db'

import { registerDashboardAlertRoutes } from './alerts'
import { registerDashboardRoutes } from './dashboards'
import { registerDashboardPanelRoutes } from './panels'

import type { TeamAuthVariables } from '@/middleware/auth'

type Row = Record<string, unknown>

const teamId = new ObjectId()
let store: Record<string, Row[]> = {}
const rowsOf = (name: string) => store[name] ?? []

const same = (a: unknown, b: unknown) => String(a) === String(b)

function matches(row: Row, query: Row): boolean {
  return Object.entries(query).every(([key, value]) => {
    if (key === '$or') return (value as Row[]).some((part) => matches(row, part))
    if (value && typeof value === 'object' && !(value instanceof ObjectId)) {
      const op = value as Row

      if ('$ne' in op) return !same(row[key], op.$ne)
      if ('$in' in op) return (op.$in as unknown[]).some((v) => same(row[key], v))
    }

    return same(row[key], value)
  })
}

function cursorOf(rows: Row[]) {
  const cursor = {
    sort: () => cursor,
    limit: () => cursor,
    next: () => Promise.resolve(rows[0] ?? null),
    toArray: () => Promise.resolve(rows),
  }

  return cursor
}

useDb({
  db: () => ({
    collection: (name: string) => {
      const rows = () => {
        store[name] ??= []

        return store[name]
      }

      return {
        find: (query: Row) => cursorOf(rows().filter((row) => matches(row, query))),
        findOne: (query: Row) => Promise.resolve(rows().find((row) => matches(row, query)) ?? null),
        insertOne: (doc: Row) => {
          rows().push(doc)

          return Promise.resolve({ insertedId: doc._id })
        },
        findOneAndUpdate: (query: Row, update: { $set?: Row; $unset?: Row }) => {
          const row = rows().find((r) => matches(r, query))

          if (!row) return Promise.resolve(null)
          Object.assign(row, update.$set)
          for (const key of Object.keys(update.$unset ?? {})) delete row[key]

          return Promise.resolve(row)
        },
        updateOne: () => Promise.resolve({}),
        deleteOne: (query: Row) => {
          store[name] = rows().filter((row) => !matches(row, query))

          return Promise.resolve({})
        },
        deleteMany: (query: Row) => {
          store[name] = rows().filter((row) => !matches(row, query))

          return Promise.resolve({})
        },
      }
    },
  }),
})

const app = new Hono<{ Variables: TeamAuthVariables }>()

app.onError((err, c) =>
  err instanceof AppError
    ? c.json({ error: err.message }, err.status as 403)
    : c.json({ error: String(err) }, 500),
)
app.use('*', async (c, next) => {
  c.set('teamId', teamId.toHexString())
  c.set('userId', c.req.header('x-user') ?? 'nobody')
  c.set('teamRole', (c.req.header('x-role') ?? 'EDITOR') as TeamAuthVariables['teamRole'])
  await next()
})
registerDashboardRoutes(app)
registerDashboardPanelRoutes(app)
registerDashboardAlertRoutes(app)

type Who = { user: string; role: 'ADMINISTRATOR' | 'EDITOR' | 'VIEWER' }
const owner: Who = { user: 'owner', role: 'EDITOR' }
const viewerOwner: Who = { user: 'viewer-owner', role: 'VIEWER' }
const teammate: Who = { user: 'teammate', role: 'EDITOR' }
const admin: Who = { user: 'admin', role: 'ADMINISTRATOR' }

function call(who: Who, method: string, path: string, body?: unknown) {
  return app.request(path, {
    method,
    headers: { 'x-user': who.user, 'x-role': who.role, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}

function dashboard(createdBy: string, visibility?: 'personal' | 'team') {
  const now = new Date('2026-11-17T00:00:00Z')

  return {
    _id: new ObjectId(),
    teamId,
    name: `${createdBy} ${visibility ?? 'legacy'}`,
    layout: [],
    timeRange: { periodStart: new Date('2026-11-01T00:00:00Z'), periodEnd: now },
    ...(visibility ? { visibility } : {}),
    createdBy,
    createdAt: now,
    updatedAt: now,
  }
}

const range = { periodStart: '2026-11-01T00:00:00.000Z', periodEnd: '2026-11-17T00:00:00.000Z' }

let personal: ReturnType<typeof dashboard>
let shared: ReturnType<typeof dashboard>
let legacy: ReturnType<typeof dashboard>
let panelId: ObjectId

beforeEach(() => {
  personal = dashboard(owner.user, 'personal')
  shared = dashboard(owner.user, 'team')
  legacy = dashboard(teammate.user)
  panelId = new ObjectId()
  store = {
    cost_dashboards: [personal, shared, legacy],
    cost_panels: [
      { _id: panelId, teamId, dashboardId: personal._id, title: 'Spend', kind: 'scalar' },
    ],
    cost_panel_alerts: [{ _id: new ObjectId(), teamId, panelId, threshold: 10 }],
  }
})

describe('the dashboard list', () => {
  test('a member sees team dashboards and their own personal ones, not another member’s', async () => {
    const mine = (await (await call(owner, 'GET', '/')).json()) as { dashboards: { id: string }[] }
    const theirs = (await (await call(teammate, 'GET', '/')).json()) as {
      dashboards: { id: string }[]
      othersPersonal?: unknown
    }

    expect(mine.dashboards.map((d) => d.id)).toContain(personal._id.toHexString())
    expect(theirs.dashboards.map((d) => d.id)).not.toContain(personal._id.toHexString())
    expect(theirs.dashboards.map((d) => d.id)).toContain(legacy._id.toHexString())
    expect(theirs.othersPersonal).toBeUndefined()
  })

  test('an Administrator sees another member’s personal dashboard only as a stub', async () => {
    const body = (await (await call(admin, 'GET', '/')).json()) as {
      dashboards: { id: string }[]
      othersPersonal: Row[]
    }

    expect(body.dashboards.map((d) => d.id)).not.toContain(personal._id.toHexString())
    expect(body.othersPersonal).toEqual([
      {
        id: personal._id.toHexString(),
        name: personal.name,
        visibility: 'personal',
        createdBy: owner.user,
        createdAt: personal.createdAt.toISOString(),
      },
    ])
  })
})

describe('another member’s personal dashboard', () => {
  const base = () => `/${personal._id.toHexString()}`
  const panel = () => `${base()}/panels/${panelId.toHexString()}`

  test('reads as not found to teammates and Administrators: dashboard, snapshots and alert', async () => {
    for (const who of [teammate, admin]) {
      expect((await call(who, 'GET', base())).status).toBe(404)
      expect((await call(who, 'GET', `${panel()}/snapshots`)).status).toBe(404)
      expect((await call(who, 'GET', `${panel()}/alert`)).status).toBe(404)
    }
  })

  test('cannot be changed by a teammate or an Administrator', async () => {
    for (const who of [teammate, admin]) {
      expect((await call(who, 'PUT', base(), { name: 'Taken' })).status).toBe(404)
      expect((await call(who, 'DELETE', panel())).status).toBe(404)
    }
    expect(personal.name).toBe('owner personal')
  })

  test('can be deleted by an Administrator, but not by an Editor', async () => {
    expect((await call(teammate, 'DELETE', base())).status).toBe(404)
    expect((await call(admin, 'DELETE', base())).status).toBe(204)
    expect(rowsOf('cost_dashboards').map((d) => String(d._id))).not.toContain(String(personal._id))
    expect(rowsOf('cost_panels')).toHaveLength(0)
  })

  test('its creator reads it with edit rights', async () => {
    // The read itself is what is checked here, not how a panel serializes.
    store.cost_panels = []
    const res = await call(owner, 'GET', base())
    const body = (await res.json()) as { canEdit: boolean; dashboard: { visibility: string } }

    expect(res.status).toBe(200)
    expect(body.canEdit).toBe(true)
    expect(body.dashboard.visibility).toBe('personal')
  })
})

describe('creating', () => {
  test('a request without visibility creates a team dashboard, as older clients expect', async () => {
    const res = await call(owner, 'POST', '/', { name: 'Old client', timeRange: range })
    const body = (await res.json()) as { visibility: string }

    expect(res.status).toBe(201)
    expect(body.visibility).toBe('team')
  })

  test('a Viewer creates a personal dashboard, but not a team one', async () => {
    const mine = await call(viewerOwner, 'POST', '/', {
      name: 'Mine',
      timeRange: range,
      visibility: 'personal',
    })
    const team = await call(viewerOwner, 'POST', '/', {
      name: 'Team',
      timeRange: range,
      visibility: 'team',
    })

    expect(mine.status).toBe(201)
    expect(team.status).toBe(403)
  })
})

describe('editing and visibility', () => {
  test('a Viewer edits their own personal dashboard, but not a team one', async () => {
    const own = dashboard(viewerOwner.user, 'personal')

    rowsOf('cost_dashboards').push(own)
    expect(
      (await call(viewerOwner, 'PUT', `/${own._id.toHexString()}`, { name: 'Renamed' })).status,
    ).toBe(200)
    expect(
      (await call(viewerOwner, 'PUT', `/${shared._id.toHexString()}`, { name: 'Renamed' })).status,
    ).toBe(403)
  })

  test('only the creator shares a personal dashboard, and a Viewer creator cannot', async () => {
    const own = dashboard(viewerOwner.user, 'personal')

    rowsOf('cost_dashboards').push(own)
    expect(
      (await call(viewerOwner, 'PUT', `/${own._id.toHexString()}`, { visibility: 'team' })).status,
    ).toBe(403)
    expect(
      (await call(owner, 'PUT', `/${personal._id.toHexString()}`, { visibility: 'team' })).status,
    ).toBe(200)
    expect(personal.visibility).toBe('team')
  })

  test('only the creator makes a team dashboard personal again', async () => {
    expect(
      (await call(admin, 'PUT', `/${shared._id.toHexString()}`, { visibility: 'personal' })).status,
    ).toBe(403)
    expect(
      (await call(owner, 'PUT', `/${shared._id.toHexString()}`, { visibility: 'personal' })).status,
    ).toBe(200)
    expect(shared.visibility).toBe('personal')
  })
})
