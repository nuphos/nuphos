import { ObjectId } from 'mongodb'
import { z } from 'zod'

import {
  presetWindow,
  resolveLastSuccessfulPanelSnapshots,
  resolvePanelSnapshots,
} from '@/lib/dashboards/exec-service'
import { dashboardCadenceUpdate } from '@/lib/dashboards/refresh-cadence'
import { AppError } from '@/lib/errors'
import { parseObjectId } from '@/lib/objectid'
import { zv } from '@/lib/validate'
import { requireTeamRole } from '@/middleware/auth'
import {
  nuphosDashboards,
  dashboardPanelAlerts,
  dashboardPanelInsights,
  dashboardPanels,
  dashboardPanelSnapshots,
} from '@/models'

import { dashboardForView, dashboardViewSchema } from './view-range'

import { resolvePanelInsights, serializeDashboard, serializePanel } from './serialize'

import type { TeamAuthVariables } from '@/middleware/auth'
import type { NuphosDashboard, DashboardTimeRange } from '@/models'
import type { Hono } from 'hono'

// ---------------------------------------------------------------------------
// Dashboards
// ---------------------------------------------------------------------------

const paramsSchema = z
  .object({
    periodStart: z.string().datetime(),
    periodEnd: z.string().datetime(),
    granularity: z.enum(['day', 'week', 'month']).optional(),
  })
  .refine((v) => new Date(v.periodStart) < new Date(v.periodEnd), {
    message: 'periodStart must be before periodEnd',
    path: ['periodEnd'],
  })

const rangePresetSchema = z.enum(['last7', 'last14', 'last30', 'thisMonth', 'prevMonth'])

export const cadenceSchema = z.enum(['daily', 'weekly', 'monthly'])

/** Build the stored window: a rolling preset is computed server-side (quantized
 *  to day) and advanced on refresh; otherwise use the caller's explicit range. */
function resolveTimeRange(
  input: { periodStart: string; periodEnd: string; granularity?: 'day' | 'week' | 'month' },
  preset?: z.infer<typeof rangePresetSchema>,
): DashboardTimeRange {
  const base = preset
    ? presetWindow(preset)
    : { periodStart: new Date(input.periodStart), periodEnd: new Date(input.periodEnd) }

  return { ...base, ...(input.granularity ? { granularity: input.granularity } : {}) }
}

const createDashboardSchema = z.object({
  name: z.string().trim().min(1).max(200),
  timeRange: paramsSchema,
  rangePreset: rangePresetSchema.optional(),
})

export async function loadDashboard(
  teamIdRaw: string,
  dashboardIdRaw: string,
): Promise<{ teamId: ObjectId; dashboard: NuphosDashboard }> {
  const teamId = parseObjectId(teamIdRaw, 'teamId')
  const dashboardId = parseObjectId(dashboardIdRaw, 'dashboardId')
  const dashboard = await nuphosDashboards().findOne({ _id: dashboardId, teamId })

  if (!dashboard) throw new AppError(404, 'dashboard_not_found', 'Dashboard not found')

  return { teamId, dashboard }
}

const updateDashboardSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  timeRange: paramsSchema.optional(),
  // A preset makes the range roll (advanced on refresh); `null` switches back to
  // the fixed custom range in `timeRange`.
  rangePreset: rangePresetSchema.nullable().optional(),
  cadence: cadenceSchema.nullable().optional(),
  layout: z
    .array(
      z.object({
        panelId: z.string(),
        x: z.number().int().min(0).max(1000),
        y: z.number().int().min(0).max(10000),
        w: z.number().int().min(1).max(64),
        h: z.number().int().min(1).max(64),
      }),
    )
    .max(200)
    .optional(),
})

export function registerDashboardRoutes(
  nuphosDashboardsRoutes: Hono<{ Variables: TeamAuthVariables }>,
): void {
  nuphosDashboardsRoutes.get('/', async (c) => {
    const teamId = parseObjectId(c.get('teamId'), 'teamId')
    const docs = await nuphosDashboards().find({ teamId }).sort({ updatedAt: -1 }).toArray()

    return c.json({ dashboards: docs.map(serializeDashboard) })
  })

  nuphosDashboardsRoutes.post(
    '/',
    requireTeamRole('ADMINISTRATOR', 'EDITOR'),
    zv('json', createDashboardSchema),
    async (c) => {
      const teamId = parseObjectId(c.get('teamId'), 'teamId')
      const input = c.req.valid('json')
      const now = new Date()
      const doc: NuphosDashboard = {
        _id: new ObjectId(),
        teamId,
        name: input.name,
        layout: [],
        timeRange: resolveTimeRange(input.timeRange, input.rangePreset),
        ...(input.rangePreset ? { rangePreset: input.rangePreset } : {}),
        createdBy: c.get('userId'),
        createdAt: now,
        updatedAt: now,
      }

      await nuphosDashboards().insertOne(doc)

      return c.json(serializeDashboard(doc), 201)
    },
  )

  nuphosDashboardsRoutes.get('/:dashboardId', zv('query', dashboardViewSchema), async (c) => {
    const { teamId, dashboard } = await loadDashboard(c.get('teamId'), c.req.param('dashboardId'))
    const view = dashboardForView(dashboard, c.req.valid('query'))
    const panels = await dashboardPanels().find({ teamId, dashboardId: dashboard._id }).toArray()
    const [snapshots, successfulSnapshots] = await Promise.all([
      resolvePanelSnapshots(teamId, view, panels),
      resolveLastSuccessfulPanelSnapshots(teamId, panels, view),
    ])
    const insights = await resolvePanelInsights(teamId, panels, snapshots)

    return c.json({
      dashboard: serializeDashboard(dashboard),
      viewTimeRange: serializeDashboard(view).timeRange,
      canEdit: ['ADMINISTRATOR', 'EDITOR'].includes(c.get('teamRole')),
      panels: panels.map((p) =>
        serializePanel(
          p,
          dashboard,
          snapshots.get(p._id.toHexString()) ?? null,
          insights.get(p._id.toHexString()),
          successfulSnapshots.get(p._id.toHexString()) ?? null,
        ),
      ),
    })
  })

  nuphosDashboardsRoutes.put(
    '/:dashboardId',
    requireTeamRole('ADMINISTRATOR', 'EDITOR'),
    zv('json', updateDashboardSchema),
    async (c) => {
      const { teamId, dashboard } = await loadDashboard(c.get('teamId'), c.req.param('dashboardId'))
      const input = c.req.valid('json')
      const set: Partial<NuphosDashboard> = { updatedAt: new Date() }
      const unset: Record<string, ''> = {}

      if (input.name !== undefined) set.name = input.name
      // Time range + rolling preset. A preset (re)computes the window and marks it
      // rolling; a custom timeRange (or explicit `rangePreset: null`) clears it so
      // the range stops advancing. Layout-only updates touch neither.
      if (input.rangePreset) {
        set.rangePreset = input.rangePreset
        const granularity = input.timeRange?.granularity ?? dashboard.timeRange.granularity

        set.timeRange = {
          ...presetWindow(input.rangePreset),
          ...(granularity ? { granularity } : {}),
        }
      } else if (input.timeRange) {
        set.timeRange = resolveTimeRange(input.timeRange)
        unset.rangePreset = ''
      } else if (input.rangePreset === null) {
        unset.rangePreset = ''
      }
      if (input.cadence !== undefined) {
        const cadence = dashboardCadenceUpdate(dashboard, input.cadence)

        Object.assign(set, cadence.set)
        Object.assign(unset, cadence.unset)
      }
      if (input.layout) {
        set.layout = input.layout.map((l) => ({
          panelId: parseObjectId(l.panelId, 'panelId'),
          x: l.x,
          y: l.y,
          w: l.w,
          h: l.h,
        }))
      }

      const updated = await nuphosDashboards().findOneAndUpdate(
        { _id: dashboard._id, teamId },
        Object.keys(unset).length ? { $set: set, $unset: unset } : { $set: set },
        { returnDocument: 'after' },
      )

      if (!updated) throw new AppError(404, 'dashboard_not_found', 'Dashboard not found')

      return c.json(serializeDashboard(updated))
    },
  )

  nuphosDashboardsRoutes.delete(
    '/:dashboardId',
    requireTeamRole('ADMINISTRATOR', 'EDITOR'),
    async (c) => {
      const { teamId, dashboard } = await loadDashboard(c.get('teamId'), c.req.param('dashboardId'))
      const panels = await dashboardPanels()
        .find({ teamId, dashboardId: dashboard._id }, { projection: { _id: 1 } })
        .toArray()
      const panelIds = panels.map((p) => p._id)

      // Cascade: panels, their snapshots, insights, alerts.
      if (panelIds.length) {
        await Promise.all([
          dashboardPanelSnapshots().deleteMany({ teamId, panelId: { $in: panelIds } }),
          dashboardPanelInsights().deleteMany({ teamId, panelId: { $in: panelIds } }),
          dashboardPanelAlerts().deleteMany({ teamId, panelId: { $in: panelIds } }),
        ])
      }
      await dashboardPanels().deleteMany({ teamId, dashboardId: dashboard._id })
      await nuphosDashboards().deleteOne({ _id: dashboard._id, teamId })

      return c.body(null, 204)
    },
  )
}
