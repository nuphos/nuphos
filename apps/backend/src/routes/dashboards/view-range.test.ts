import { beforeEach, expect, test } from 'bun:test'
import { ObjectId } from 'mongodb'
import { Hono } from 'hono'

import { AppError } from '@/lib/errors'

import { useDb } from '@/lib/test/doubles/db'
import { panelSnapshotKey } from '@/lib/dashboards/exec-service'
import { evaluatePanelAlert } from '@/lib/dashboards/alert-service'
import { dashboardForView, dashboardViewSchema } from './view-range'
import { registerDashboardRoutes } from './dashboards'
import { registerDashboardExecutionRoutes } from './execution'
import type { NuphosDashboard, DashboardPanel, DashboardPanelSnapshot } from '@/models'
import type { TeamAuthVariables } from '@/middleware/auth'

const teamId = new ObjectId()
const dashboard: NuphosDashboard = {
  _id: new ObjectId(),
  teamId,
  name: 'Costs',
  layout: [],
  timeRange: {
    periodStart: new Date('2026-09-01T00:00:00Z'),
    periodEnd: new Date('2026-09-26T23:59:59Z'),
    granularity: 'day',
  },
  cadence: 'daily',
  createdBy: 'u1',
  createdAt: new Date(),
  updatedAt: new Date(),
}
const panel: DashboardPanel = {
  _id: new ObjectId(),
  teamId,
  dashboardId: dashboard._id,
  title: 'Cost',
  kind: 'scalar',
  scriptVersion: 1,
  versions: [
    { version: 1, code: 'emit({})', codeHash: 'h', authoredBy: 'u1', createdAt: new Date() },
  ],
  createdBy: 'u1',
  createdAt: new Date(),
  updatedAt: new Date(),
}
const historical = {
  periodStart: '2026-08-01T00:00:00.000Z',
  periodEnd: '2026-08-31T23:59:59.999Z',
}
let lookups: Record<string, unknown>[] = []
let alertReads = 0
let savedDashboard = dashboard
let reuseSnapshot = false
let dashboardWrites = 0

useDb({
  db: () => ({
    collection: (name: string) => ({
      findOne: () => {
        if (name === 'cost_panel_alerts') alertReads++

        return Promise.resolve(
          name === 'cost_dashboards' ? savedDashboard : name === 'cost_panels' ? panel : null,
        )
      },
      findOneAndUpdate: (
        _filter: unknown,
        update: { $set: Partial<NuphosDashboard>; $unset?: Record<string, string> },
      ) => {
        if (name !== 'cost_dashboards') throw new Error('Unexpected write')
        dashboardWrites++
        savedDashboard = { ...savedDashboard, ...update.$set }
        if (update.$unset && 'rangePreset' in update.$unset) delete savedDashboard.rangePreset

        return Promise.resolve(savedDashboard)
      },
      find: (filter: Record<string, unknown>) => {
        if (name === 'cost_panel_snapshots') lookups.push(filter)
        const cursor = {
          sort: () => cursor,
          limit: () => cursor,
          next: () =>
            Promise.resolve(
              reuseSnapshot && name === 'cost_panel_snapshots'
                ? {
                    _id: new ObjectId(),
                    teamId,
                    panelId: panel._id,
                    dashboardId: dashboard._id,
                    codeHash: 'h',
                    paramsHash: filter.paramsHash,
                    params: {},
                    scriptVersion: 1,
                    status: 'running',
                    requestedAt: new Date(),
                    createdAt: new Date(),
                  }
                : null,
            ),
          toArray: () => Promise.resolve(name === 'cost_panels' ? [panel] : []),
        }

        return cursor
      },
    }),
  }),
})
beforeEach(() => {
  lookups = []
  alertReads = 0
  savedDashboard = dashboard
  reuseSnapshot = false
  dashboardWrites = 0
})

test('custom and rolling views leave the saved default and schedule unchanged', () => {
  const before = structuredClone(dashboard.timeRange)
  const first = dashboardForView(dashboard, historical)
  const other = dashboardForView(dashboard, { preset: 'last7' })

  expect(first.timeRange.periodStart.toISOString()).toBe(historical.periodStart)
  expect(first.rangePreset).toBeUndefined()
  expect(other.rangePreset).toBeUndefined()
  expect(dashboard.timeRange).toEqual(before)
  expect(dashboard.cadence).toBe('daily')
  expect(panelSnapshotKey(first, panel)).not.toEqual(panelSnapshotKey(other, panel))
  expect(panelSnapshotKey(first, panel)).toEqual(
    panelSnapshotKey(dashboardForView(dashboard, historical), panel),
  )
})

test('rejects partial, reversed, invalid and ambiguous ranges', () => {
  for (const input of [
    { periodStart: historical.periodStart },
    { ...historical, periodEnd: 'bad' },
    { ...historical, periodStart: historical.periodEnd },
    { ...historical, preset: 'last7' },
    { preset: 'invalid' },
  ]) {
    expect(dashboardViewSchema.safeParse(input).success).toBe(false)
  }
})

test('GET filters both current and last-successful snapshots by the view params without writes', async () => {
  const app = new Hono<{ Variables: TeamAuthVariables }>()

  app.use('*', async (c, next) => {
    c.set('teamId', teamId.toHexString())
    await next()
  })
  registerDashboardRoutes(app)
  const response = await app.request(
    `/${dashboard._id.toHexString()}?${new URLSearchParams(historical)}`,
  )

  expect(response.status).toBe(200)
  const result = (await response.json()) as {
    viewTimeRange: { periodStart: string }
    dashboard: { timeRange: { periodStart: string } }
  }

  expect(result.viewTimeRange.periodStart).toBe(historical.periodStart)
  expect(result.dashboard.timeRange.periodStart).toBe(dashboard.timeRange.periodStart.toISOString())
  const { paramsHash } = panelSnapshotKey(dashboardForView(dashboard, historical), panel)

  expect(lookups).toHaveLength(2)
  expect(lookups.every((q) => q.paramsHash === paramsHash && q.codeHash === 'h')).toBe(true)
})

test('browsing historical data cannot evaluate shared alerts', async () => {
  await evaluatePanelAlert({
    teamId,
    panel,
    snapshot: {
      viewOnly: true,
      status: 'complete',
      output: { kind: 'scalar', title: 'Cost', value: 999, unit: 'usd' },
    } as DashboardPanelSnapshot,
  })
  expect(alertReads).toBe(0)
})

for (const action of ['refresh', `panels/${panel._id.toHexString()}/execute`]) {
  for (const query of ['', '?preset=prevMonth']) {
    test(`${action}${query}: only default execution advances the saved rolling window`, async () => {
      savedDashboard = { ...dashboard, rangePreset: 'last7' }
      reuseSnapshot = true
      const app = new Hono<{ Variables: TeamAuthVariables }>()

      app.use('*', async (c, next) => {
        c.set('teamId', teamId.toHexString())
        c.set('teamRole', 'EDITOR')
        await next()
      })
      registerDashboardExecutionRoutes(app)
      const response = await app.request(`/${dashboard._id.toHexString()}/${action}${query}`, {
        method: 'POST',
      })

      expect(response.status).toBe(200)
      expect(dashboardWrites).toBe(query ? 0 : 1)
      expect(savedDashboard.rangePreset).toBe('last7')
      if (query) expect(savedDashboard.timeRange).toEqual(dashboard.timeRange)
      else
        expect(savedDashboard.timeRange.periodEnd.getTime()).toBeGreaterThan(
          dashboard.timeRange.periodEnd.getTime(),
        )
      const expected = dashboardForView(savedDashboard, query ? { preset: 'prevMonth' } : {})

      expect(lookups[0]?.paramsHash).toBe(panelSnapshotKey(expected, panel).paramsHash)
    })
  }
}

for (const role of ['ADMINISTRATOR', 'EDITOR', 'VIEWER'] as const) {
  test(`${role}: only editors can explicitly save the current range as default`, async () => {
    const app = new Hono<{ Variables: TeamAuthVariables }>()

    app.onError((err, c) =>
      c.json({ error: err.message }, err instanceof AppError ? err.status : 500),
    )
    app.use('*', async (c, next) => {
      c.set('teamId', teamId.toHexString())
      c.set('teamRole', role)
      await next()
    })
    registerDashboardRoutes(app)
    const path = `/${dashboard._id.toHexString()}`
    const viewed = await app.request(`${path}?preset=last7`)
    const detail = (await viewed.json()) as { canEdit: boolean }
    const canEdit = role !== 'VIEWER'

    expect(detail.canEdit).toBe(canEdit)
    expect(dashboardWrites).toBe(0)
    for (const patch of [
      { rangePreset: 'last7' as const },
      { timeRange: { ...historical, granularity: 'day' }, rangePreset: null },
    ]) {
      const saved = await app.request(path, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })

      expect(saved.status).toBe(canEdit ? 200 : 403)
      if (!canEdit) continue
      expect(savedDashboard.rangePreset).toBe(patch.rangePreset ?? undefined)
      if (patch.timeRange)
        expect(savedDashboard.timeRange.periodStart.toISOString()).toBe(historical.periodStart)
      expect(savedDashboard.cadence).toBe('daily')
    }
    expect(dashboardWrites).toBe(canEdit ? 2 : 0)
  })
}
