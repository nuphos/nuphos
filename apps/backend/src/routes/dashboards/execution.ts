import { z } from 'zod'

import { executePanel, refreshDashboard } from '@/lib/dashboards/exec-service'
import { AppError } from '@/lib/errors'
import { zv } from '@/lib/validate'
import { requireTeamRole } from '@/middleware/auth'
import { nuphosDashboards } from '@/models'

import { loadDashboard } from './dashboards'
import { loadPanel } from './panels'
import { serializeSnapshot } from './serialize'
import { dashboardForView, dashboardViewSchema } from './view-range'

import type { TeamAuthVariables } from '@/middleware/auth'
import type { Hono } from 'hono'

// ---------------------------------------------------------------------------
// Execution
// ---------------------------------------------------------------------------

// `force=1`/`true` bypasses dedupe; absent or anything else reuses. (Not
// z.coerce.boolean() — that coerces the strings "0"/"false" to true.)
const forceSchema = z
  .object({ force: z.string().optional() })
  .transform((q) => ({ force: q.force === '1' || q.force === 'true' }))

export function registerDashboardExecutionRoutes(
  nuphosDashboardsRoutes: Hono<{ Variables: TeamAuthVariables }>,
): void {
  /** Re-execute every panel of the dashboard and return the resulting snapshots. */
  nuphosDashboardsRoutes.post(
    '/:dashboardId/refresh',
    requireTeamRole('ADMINISTRATOR', 'EDITOR'),
    zv('query', dashboardViewSchema.and(forceSchema)),
    async (c) => {
      const { teamId, dashboard } = await loadDashboard(c.get('teamId'), c.req.param('dashboardId'))
      const query = c.req.valid('query')
      const viewOnly = Boolean(query.preset || query.periodStart || query.granularity)
      const snapshots = await refreshDashboard({
        teamId,
        dashboard: viewOnly ? dashboardForView(dashboard, query) : dashboard,
        viewOnly,
        force: query.force,
      })

      return c.json({ snapshots: snapshots.map(serializeSnapshot) })
    },
  )

  /** Re-execute a single panel; `?force=1` bypasses snapshot dedupe. */
  nuphosDashboardsRoutes.post(
    '/:dashboardId/panels/:panelId/execute',
    requireTeamRole('ADMINISTRATOR', 'EDITOR'),
    zv('query', dashboardViewSchema.and(forceSchema)),
    async (c) => {
      const { teamId, panel } = await loadPanel(
        c.get('teamId'),
        c.req.param('dashboardId'),
        c.req.param('panelId'),
      )
      const dashboard = await nuphosDashboards().findOne({ _id: panel.dashboardId, teamId })

      if (!dashboard) throw new AppError(404, 'dashboard_not_found', 'Dashboard not found')
      const query = c.req.valid('query')
      const viewOnly = Boolean(query.preset || query.periodStart || query.granularity)
      const snapshot = await executePanel({
        teamId,
        dashboard: viewOnly ? dashboardForView(dashboard, query) : dashboard,
        viewOnly,
        panel,
        force: query.force,
      })

      return c.json(serializeSnapshot(snapshot))
    },
  )
}
