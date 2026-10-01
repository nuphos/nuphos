import { createHash } from 'node:crypto'

import { ObjectId } from 'mongodb'
import { z } from 'zod'

import {
  executePanel,
  resolveLastSuccessfulPanelSnapshots,
  resolvePanelSnapshots,
} from '@/lib/dashboards/exec-service'
import { dashboardCadenceUpdate, setDashboardCadence } from '@/lib/dashboards/refresh-cadence'
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
import { resolveAgentCredentialAccess } from '@/routes/agent/credential-resolve'

import { cadenceSchema, loadDashboard } from './dashboards'
import { appendScriptVersion, serializePanel, serializeSnapshot } from './serialize'

import type { TeamAuthVariables } from '@/middleware/auth'
import type { NuphosDashboard, DashboardPanel, DashboardPanelScriptVersion } from '@/models'
import type { Hono } from 'hono'

const panelKindSchema = z.enum(['chart', 'scalar', 'table'])

const createPanelSchema = z.object({
  title: z.string().trim().min(1).max(200),
  kind: panelKindSchema,
  code: z.string().min(1).max(200_000),
  // Panel-specific non-time config (provider, accountId, filters…). The time
  // window is NOT settable here — it always comes from the dashboard.
  staticParams: z.record(z.unknown()).optional(),
  /** Sets the dashboard's schedule; accepted for desktops that still edit it per panel. */
  cadence: cadenceSchema.optional(),
  credentialAccess: z.record(z.unknown()).optional(),
})

/** Selections are validated against the saving member's own allow lists; the
 *  panel's principal is re-checked on every credential request at run time. */
async function panelCredentialAccess(teamId: ObjectId, userId: string, selection: unknown) {
  const { access } = await resolveAgentCredentialAccess({
    teamId: teamId.toHexString(),
    userId,
    selection,
  })

  return access
}

export async function loadPanel(
  teamIdRaw: string,
  dashboardIdRaw: string,
  panelIdRaw: string,
): Promise<{ teamId: ObjectId; dashboard: NuphosDashboard; panel: DashboardPanel }> {
  const teamId = parseObjectId(teamIdRaw, 'teamId')
  const dashboardId = parseObjectId(dashboardIdRaw, 'dashboardId')
  const panelId = parseObjectId(panelIdRaw, 'panelId')
  const dashboard = await nuphosDashboards().findOne({ _id: dashboardId, teamId })

  if (!dashboard) throw new AppError(404, 'dashboard_not_found', 'Dashboard not found')
  const panel = await dashboardPanels().findOne({ _id: panelId, teamId, dashboardId })

  if (!panel) throw new AppError(404, 'panel_not_found', 'Panel not found')

  return { teamId, dashboard, panel }
}

const updatePanelSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  kind: panelKindSchema.optional(),
  code: z.string().min(1).max(200_000).optional(),
  staticParams: z.record(z.unknown()).nullable().optional(),
  /** Sets the dashboard's schedule; accepted for desktops that still edit it per panel. */
  cadence: cadenceSchema.nullable().optional(),
  /** null restores the default: what a new conversation starts with. */
  credentialAccess: z.record(z.unknown()).nullable().optional(),
})

const snapshotListSchema = z.object({ limit: z.coerce.number().int().min(1).max(200).default(50) })

export function registerDashboardPanelRoutes(
  nuphosDashboardsRoutes: Hono<{ Variables: TeamAuthVariables }>,
): void {
  nuphosDashboardsRoutes.post(
    '/:dashboardId/panels',
    requireTeamRole('ADMINISTRATOR', 'EDITOR'),
    zv('json', createPanelSchema),
    async (c) => {
      const { teamId, dashboard } = await loadDashboard(c.get('teamId'), c.req.param('dashboardId'))
      const input = c.req.valid('json')
      const now = new Date()
      const version: DashboardPanelScriptVersion = {
        version: 1,
        code: input.code,
        codeHash: createHash('sha256').update(input.code).digest('hex'),
        authoredBy: c.get('userId'),
        createdAt: now,
      }
      const doc: DashboardPanel = {
        _id: new ObjectId(),
        teamId,
        dashboardId: dashboard._id,
        title: input.title,
        kind: input.kind,
        scriptVersion: 1,
        versions: [version],
        ...(input.staticParams ? { staticParams: input.staticParams } : {}),
        ...(input.credentialAccess
          ? {
              credentialAccess: await panelCredentialAccess(
                teamId,
                c.get('userId'),
                input.credentialAccess,
              ),
            }
          : {}),
        createdBy: c.get('userId'),
        createdAt: now,
        updatedAt: now,
      }

      await dashboardPanels().insertOne(doc)
      // Append to the dashboard layout so it renders on the canvas. Simple flow
      // placement; the client can rearrange via PUT /:dashboardId.
      const cadence = input.cadence ? dashboardCadenceUpdate(dashboard, input.cadence, now).set : {}

      await nuphosDashboards().updateOne(
        { _id: dashboard._id, teamId },
        {
          $push: { layout: { panelId: doc._id, x: 0, y: dashboard.layout.length, w: 12, h: 8 } },
          $set: { updatedAt: now, ...cadence },
        },
      )
      // Kick off the first run in the background and return immediately with the
      // `running` snapshot — the client polls it to completion. Alert evaluation
      // and the one eager Insight fire from the background completion.
      const snapshot = await executePanel({
        teamId,
        dashboard,
        panel: doc,
        generateInsight: true,
      })

      return c.json(serializePanel(doc, { ...dashboard, ...cadence }, snapshot), 201)
    },
  )

  nuphosDashboardsRoutes.put(
    '/:dashboardId/panels/:panelId',
    requireTeamRole('ADMINISTRATOR', 'EDITOR'),
    zv('json', updatePanelSchema),
    async (c) => {
      const { teamId, dashboard, panel } = await loadPanel(
        c.get('teamId'),
        c.req.param('dashboardId'),
        c.req.param('panelId'),
      )
      const input = c.req.valid('json')
      const now = new Date()
      const set: Partial<DashboardPanel> = { updatedAt: now }
      const unset: Record<string, ''> = {}

      if (input.title !== undefined) set.title = input.title
      if (input.kind !== undefined) set.kind = input.kind
      if (input.staticParams === null) unset.staticParams = ''
      else if (input.staticParams !== undefined) set.staticParams = input.staticParams
      if (input.credentialAccess === null) unset.credentialAccess = ''
      else if (input.credentialAccess !== undefined)
        set.credentialAccess = await panelCredentialAccess(
          teamId,
          c.get('userId'),
          input.credentialAccess,
        )

      // Editing code appends a new version; old snapshots keep their version.
      if (input.code !== undefined) {
        const bumped = appendScriptVersion(
          panel.versions,
          panel.scriptVersion,
          input.code,
          c.get('userId'),
          now,
        )

        if (bumped) {
          set.scriptVersion = bumped.scriptVersion
          set.versions = bumped.versions
        }
      }

      const updated = await dashboardPanels().findOneAndUpdate(
        { _id: panel._id, teamId },
        Object.keys(unset).length ? { $set: set, $unset: unset } : { $set: set },
        { returnDocument: 'after' },
      )

      if (!updated) throw new AppError(404, 'panel_not_found', 'Panel not found')
      const scheduled = await setDashboardCadence(dashboard, input.cadence)
      const [snapshots, successfulSnapshots] = await Promise.all([
        resolvePanelSnapshots(teamId, dashboard, [updated]),
        resolveLastSuccessfulPanelSnapshots(teamId, [updated]),
      ])

      const panelId = updated._id.toHexString()

      return c.json(
        serializePanel(
          updated,
          scheduled,
          snapshots.get(panelId) ?? null,
          undefined,
          successfulSnapshots.get(panelId) ?? null,
        ),
      )
    },
  )

  nuphosDashboardsRoutes.delete(
    '/:dashboardId/panels/:panelId',
    requireTeamRole('ADMINISTRATOR', 'EDITOR'),
    async (c) => {
      const { teamId, panel } = await loadPanel(
        c.get('teamId'),
        c.req.param('dashboardId'),
        c.req.param('panelId'),
      )

      await Promise.all([
        dashboardPanelSnapshots().deleteMany({ teamId, panelId: panel._id }),
        dashboardPanelInsights().deleteMany({ teamId, panelId: panel._id }),
        dashboardPanelAlerts().deleteMany({ teamId, panelId: panel._id }),
      ])
      await dashboardPanels().deleteOne({ _id: panel._id, teamId })
      await nuphosDashboards().updateOne(
        { _id: panel.dashboardId, teamId },
        { $pull: { layout: { panelId: panel._id } }, $set: { updatedAt: new Date() } },
      )

      return c.body(null, 204)
    },
  )

  nuphosDashboardsRoutes.get(
    '/:dashboardId/panels/:panelId/snapshots',
    zv('query', snapshotListSchema),
    async (c) => {
      const { teamId, panel } = await loadPanel(
        c.get('teamId'),
        c.req.param('dashboardId'),
        c.req.param('panelId'),
      )
      const { limit } = c.req.valid('query')
      const rows = await dashboardPanelSnapshots()
        .find({ teamId, panelId: panel._id })
        .sort({ requestedAt: -1 })
        .limit(limit)
        .toArray()

      return c.json({ snapshots: rows.map(serializeSnapshot) })
    },
  )

  nuphosDashboardsRoutes.get('/:dashboardId/panels/:panelId/snapshots/:snapshotId', async (c) => {
    const { teamId, panel } = await loadPanel(
      c.get('teamId'),
      c.req.param('dashboardId'),
      c.req.param('panelId'),
    )
    const sid = parseObjectId(c.req.param('snapshotId'), 'snapshotId')
    const snapshot = await dashboardPanelSnapshots().findOne({
      _id: sid,
      teamId,
      panelId: panel._id,
    })

    if (!snapshot)
      throw new AppError(404, 'snapshot_not_found', 'Snapshot not found for this panel')

    return c.json(serializeSnapshot(snapshot))
  })
}
