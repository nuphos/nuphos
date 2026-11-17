import { ObjectId } from 'mongodb'
import { z } from 'zod'

import {
  presetWindow,
  resolveLastSuccessfulPanelSnapshots,
  resolvePanelSnapshots,
} from '@/lib/dashboards/exec-service'
import { currentMemberIds } from '@/lib/dashboards/members'
import { dashboardCadenceUpdate } from '@/lib/dashboards/refresh-cadence'
import {
  canCreateDashboard,
  canEditDashboard,
  canReadDashboard,
  readableFilter,
} from '@/lib/dashboards/visibility'
import { AppError } from '@/lib/errors'
import { parseObjectId } from '@/lib/objectid'
import { zv } from '@/lib/validate'
import {
  nuphosDashboards,
  dashboardPanelAlerts,
  dashboardPanels,
  dashboardPanelSnapshots,
} from '@/models'

import { loadDashboard, viewerOf, visibilityUpdate, WRITE_ROLES } from './access'
import { serializeDashboard, serializePanel } from './serialize'
import { dashboardForView, dashboardViewSchema } from './view-range'

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

const visibilitySchema = z.enum(['personal', 'team'])

const createDashboardSchema = z.object({
  name: z.string().trim().min(1).max(200),
  timeRange: paramsSchema,
  rangePreset: rangePresetSchema.optional(),
  // Absent means team, so an older client keeps creating shared dashboards.
  visibility: visibilitySchema.optional(),
})

const updateDashboardSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  timeRange: paramsSchema.optional(),
  // A preset makes the range roll (advanced on refresh); `null` switches back to
  // the fixed custom range in `timeRange`.
  rangePreset: rangePresetSchema.nullable().optional(),
  cadence: cadenceSchema.nullable().optional(),
  // Only the creator changes it; sharing also takes the team write roles.
  visibility: visibilitySchema.optional(),
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
    const viewer = viewerOf(c)
    const admin = viewer.role === 'ADMINISTRATOR'
    const docs = await nuphosDashboards()
      .find(admin ? { teamId } : { teamId, ...readableFilter(viewer) })
      .sort({ updatedAt: -1 })
      .toArray()
    // An Administrator also gets the personal dashboards of those no longer in the team,
    // which they can take over. A current member's personal dashboard stays out.
    const members = admin ? await currentMemberIds(teamId) : null

    return c.json({
      dashboards: docs.filter((doc) => canReadDashboard(doc, viewer)).map(serializeDashboard),
      ...(members
        ? {
            formerMembers: docs
              .filter((doc) => !canReadDashboard(doc, viewer) && !members.has(doc.createdBy))
              .map(serializeDashboard),
          }
        : {}),
    })
  })

  nuphosDashboardsRoutes.post('/', zv('json', createDashboardSchema), async (c) => {
    const teamId = parseObjectId(c.get('teamId'), 'teamId')
    const input = c.req.valid('json')
    const visibility = input.visibility ?? 'team'

    if (!canCreateDashboard(viewerOf(c), visibility)) {
      throw new AppError(403, 'forbidden', WRITE_ROLES)
    }
    const now = new Date()
    const doc: NuphosDashboard = {
      _id: new ObjectId(),
      teamId,
      name: input.name,
      layout: [],
      timeRange: resolveTimeRange(input.timeRange, input.rangePreset),
      ...(input.rangePreset ? { rangePreset: input.rangePreset } : {}),
      visibility,
      createdBy: c.get('userId'),
      createdAt: now,
      updatedAt: now,
    }

    await nuphosDashboards().insertOne(doc)

    return c.json(serializeDashboard(doc), 201)
  })

  nuphosDashboardsRoutes.get('/:dashboardId', zv('query', dashboardViewSchema), async (c) => {
    const viewer = viewerOf(c)
    const { teamId, dashboard, inTeam } = await loadDashboard(
      c.get('teamId'),
      c.req.param('dashboardId'),
      viewer,
    )
    const query = c.req.valid('query')
    const view = dashboardForView(dashboard, query)
    const preset = query.preset ?? (query.periodStart ? undefined : dashboard.rangePreset)
    const panels = await dashboardPanels().find({ teamId, dashboardId: dashboard._id }).toArray()
    const [snapshots, successfulSnapshots] = await Promise.all([
      resolvePanelSnapshots(teamId, view, panels),
      resolveLastSuccessfulPanelSnapshots(teamId, panels, view, preset),
    ])

    return c.json({
      dashboard: serializeDashboard(dashboard),
      viewTimeRange: serializeDashboard(view).timeRange,
      canEdit: canEditDashboard(dashboard, viewer, inTeam),
      panels: panels.map((p) =>
        serializePanel(
          p,
          dashboard,
          snapshots.get(p._id.toHexString()) ?? null,
          successfulSnapshots.get(p._id.toHexString()) ?? null,
        ),
      ),
    })
  })

  nuphosDashboardsRoutes.put('/:dashboardId', zv('json', updateDashboardSchema), async (c) => {
    const viewer = viewerOf(c)
    const { teamId, dashboard, inTeam } = await loadDashboard(
      c.get('teamId'),
      c.req.param('dashboardId'),
      viewer,
      'edit',
    )
    const input = c.req.valid('json')
    const set: Partial<NuphosDashboard> = { updatedAt: new Date() }
    const unset: Record<string, ''> = {}

    const visibility = visibilityUpdate(dashboard, viewer, input.visibility, inTeam)

    if (visibility) set.visibility = visibility
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
  })

  nuphosDashboardsRoutes.delete('/:dashboardId', async (c) => {
    const { teamId, dashboard } = await loadDashboard(
      c.get('teamId'),
      c.req.param('dashboardId'),
      viewerOf(c),
      'delete',
    )
    const panels = await dashboardPanels()
      .find({ teamId, dashboardId: dashboard._id }, { projection: { _id: 1 } })
      .toArray()
    const panelIds = panels.map((p) => p._id)

    // Cascade: panels, their snapshots, alerts.
    if (panelIds.length) {
      await Promise.all([
        dashboardPanelSnapshots().deleteMany({ teamId, panelId: { $in: panelIds } }),
        dashboardPanelAlerts().deleteMany({ teamId, panelId: { $in: panelIds } }),
      ])
    }
    await dashboardPanels().deleteMany({ teamId, dashboardId: dashboard._id })
    await nuphosDashboards().deleteOne({ _id: dashboard._id, teamId })

    return c.body(null, 204)
  })
}
