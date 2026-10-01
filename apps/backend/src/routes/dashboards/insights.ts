import { z } from 'zod'

import { resolvePanelSnapshots } from '@/lib/dashboards/exec-service'
import { getLatestInsight, startInsightGeneration } from '@/lib/dashboards/insight-service'
import { AppError } from '@/lib/errors'
import { zv } from '@/lib/validate'
import { requireTeamRole } from '@/middleware/auth'
import { dashboardPanelInsights } from '@/models'

import { loadPanel } from './panels'
import { serializeInsight } from './serialize'
import { dashboardForView, dashboardViewSchema } from './view-range'

import type { TeamAuthVariables } from '@/middleware/auth'
import type { Hono } from 'hono'

// ---------------------------------------------------------------------------
// Insights (a separate AI pass over a snapshot; NOT script output)
// ---------------------------------------------------------------------------

export function registerDashboardInsightRoutes(
  nuphosDashboardsRoutes: Hono<{ Variables: TeamAuthVariables }>,
): void {
  /** The latest Insight for a panel + whether it's stale (bound to an older
   *  snapshot than the current one). Plain Refresh does NOT auto-regenerate; the
   *  client uses `stale` to offer a "regenerate insight?" prompt. */
  nuphosDashboardsRoutes.get(
    '/:dashboardId/panels/:panelId/insight',
    zv('query', dashboardViewSchema),
    async (c) => {
      const { teamId, dashboard, panel } = await loadPanel(
        c.get('teamId'),
        c.req.param('dashboardId'),
        c.req.param('panelId'),
      )
      const snapshots = await resolvePanelSnapshots(
        teamId,
        dashboardForView(dashboard, c.req.valid('query')),
        [panel],
      )
      const currentId = snapshots.get(panel._id.toHexString())?._id ?? null
      const { insight, stale } = await getLatestInsight(teamId, panel, currentId)

      return c.json({ insight: insight ? serializeInsight(insight) : null, stale })
    },
  )

  /** Generate/regenerate the Insight for the panel's current snapshot (explicit,
   *  user-triggered — this is the only path that spends AI on Refresh). Runs the
   *  model asynchronously: a `pending` insight is returned immediately and the
   *  client polls until it reaches `complete`/`failed`. */
  nuphosDashboardsRoutes.post(
    '/:dashboardId/panels/:panelId/insight',
    requireTeamRole('ADMINISTRATOR', 'EDITOR'),
    zv('query', dashboardViewSchema),
    async (c) => {
      const { teamId, dashboard, panel } = await loadPanel(
        c.get('teamId'),
        c.req.param('dashboardId'),
        c.req.param('panelId'),
      )
      const snapshots = await resolvePanelSnapshots(
        teamId,
        dashboardForView(dashboard, c.req.valid('query')),
        [panel],
      )
      const snapshot = snapshots.get(panel._id.toHexString())

      if (!snapshot || snapshot.status !== 'complete') {
        throw new AppError(
          400,
          'no_complete_snapshot',
          'Run the panel successfully before generating an insight',
        )
      }
      const insight = await startInsightGeneration({
        teamId,
        panel,
        snapshot,
        generatedBy: 'manual-regenerate',
      })

      if (!insight)
        throw new AppError(
          400,
          'no_complete_snapshot',
          'Run the panel successfully before generating an insight',
        )

      return c.json(serializeInsight(insight))
    },
  )
}

const feedbackSchema = z.object({
  rating: z.enum(['up', 'down']),
  note: z.string().max(2_000).optional(),
})

export function registerDashboardInsightFeedbackRoute(
  nuphosDashboardsRoutes: Hono<{ Variables: TeamAuthVariables }>,
): void {
  /** Thumbs up/down on the insight displayed for the panel's current snapshot. */
  nuphosDashboardsRoutes.post(
    '/:dashboardId/panels/:panelId/insight/feedback',
    requireTeamRole('ADMINISTRATOR', 'EDITOR'),
    zv('query', dashboardViewSchema),
    zv('json', feedbackSchema),
    async (c) => {
      const { teamId, dashboard, panel } = await loadPanel(
        c.get('teamId'),
        c.req.param('dashboardId'),
        c.req.param('panelId'),
      )
      const input = c.req.valid('json')
      const snapshots = await resolvePanelSnapshots(
        teamId,
        dashboardForView(dashboard, c.req.valid('query')),
        [panel],
      )
      const currentId = snapshots.get(panel._id.toHexString())?._id ?? null
      const { insight } = await getLatestInsight(teamId, panel, currentId)

      if (!insight) throw new AppError(404, 'insight_not_found', 'No insight to rate')
      const latest = insight

      await dashboardPanelInsights().updateOne(
        { _id: latest._id, teamId },
        {
          $set: {
            feedback: {
              rating: input.rating,
              ...(input.note ? { note: input.note } : {}),
              by: c.get('userId'),
              at: new Date(),
            },
            updatedAt: new Date(),
          },
        },
      )

      return c.json({ ok: true })
    },
  )
}
