import { db } from '@/lib/db'
import { logEvent } from '@/lib/observability'
import { nuphosDashboards } from '@/models'

import { DASHBOARD_REFRESH_CADENCES, nextScheduledRefresh } from './refresh-cadence'

import type { DashboardRefreshCadence } from '@/models'
import type { ObjectId } from 'mongodb'

type LegacyPanelCadence = {
  _id: ObjectId
  teamId: ObjectId
  dashboardId: ObjectId
  cadence?: DashboardRefreshCadence
  cadenceTriggerId?: string
}

type LegacyPanelTrigger = {
  _id: ObjectId
  dedupeKey?: string
  sourceContext?: { costPanelRefresh?: unknown }
}

const legacyPanels = () => db().collection<LegacyPanelCadence>('cost_panels')
const legacyTriggers = () => db().collection<LegacyPanelTrigger>('agent_triggers')

/**
 * Moves per-panel cadences onto their dashboard (the most frequent one wins)
 * and deletes the per-panel cron triggers that used to run them; the trigger
 * scheduler drops their job schedulers once the rows are gone. Idempotent:
 * every pass consumes what it migrates.
 */
export async function migratePanelCadencesToDashboards(now = new Date()): Promise<void> {
  const panels = await legacyPanels()
    .find(
      { $or: [{ cadence: { $exists: true } }, { cadenceTriggerId: { $exists: true } }] },
      { projection: { teamId: 1, dashboardId: 1, cadence: 1 } },
    )
    .toArray()
  const byDashboard = new Map<
    string,
    { teamId: ObjectId; dashboardId: ObjectId; cadences: Set<DashboardRefreshCadence> }
  >()

  for (const panel of panels) {
    const key = panel.dashboardId.toHexString()
    const entry = byDashboard.get(key) ?? {
      teamId: panel.teamId,
      dashboardId: panel.dashboardId,
      cadences: new Set(),
    }

    if (panel.cadence) entry.cadences.add(panel.cadence)
    byDashboard.set(key, entry)
  }

  let dashboardsScheduled = 0

  for (const [dashboardId, entry] of byDashboard) {
    const cadence = DASHBOARD_REFRESH_CADENCES.find((candidate) => entry.cadences.has(candidate))

    if (entry.cadences.size > 1) {
      logEvent('warn', 'dashboard.cadence_migration.conflict', {
        dashboard_id: dashboardId,
        panel_cadences: [...entry.cadences],
        chosen: cadence,
      })
    }
    if (!cadence) continue
    const result = await nuphosDashboards().updateOne(
      { _id: entry.dashboardId, teamId: entry.teamId, cadence: { $exists: false } },
      { $set: { cadence, nextRefreshAt: nextScheduledRefresh(cadence, now) } },
    )

    dashboardsScheduled += result.modifiedCount
  }
  if (panels.length > 0) {
    await legacyPanels().updateMany(
      { _id: { $in: panels.map((panel) => panel._id) } },
      { $unset: { cadence: '', cadenceTriggerId: '' } },
    )
  }

  const triggers = await legacyTriggers()
    .find(
      {
        $or: [
          { 'sourceContext.costPanelRefresh': { $exists: true } },
          { dedupeKey: { $regex: '^cost-panel:' } },
        ],
      },
      { projection: { _id: 1 } },
    )
    .toArray()

  if (triggers.length > 0) {
    await legacyTriggers().deleteMany({ _id: { $in: triggers.map((trigger) => trigger._id) } })
  }

  if (panels.length > 0 || triggers.length > 0) {
    logEvent('info', 'dashboard.cadence_migration.completed', {
      panels_migrated: panels.length,
      dashboards_scheduled: dashboardsScheduled,
      triggers_removed: triggers.length,
    })
  }
}
