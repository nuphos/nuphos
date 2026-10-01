import { logError, logEvent } from '@/lib/observability'
import { nuphosDashboards } from '@/models'

import { refreshDashboard } from './exec/execute'
import { DASHBOARD_REFRESH_CADENCES, nextScheduledRefresh } from './refresh-cadence'
import { migratePanelCadencesToDashboards } from './refresh-schedule-migration'

import type { NuphosDashboard } from '@/models'

const SWEEP_INTERVAL_MS = 60_000
const MAX_REFRESHES_PER_SWEEP = 50
// Replicas of the previous release keep serving during a rolling deploy and can
// still write panel cadence triggers after this replica's boot pass. Must run
// before the trigger worker starts, or a panel trigger would fire as an agent run.
const MIGRATION_RERUN_DELAY_MS = 15 * 60_000

async function claimDueDashboard(now: Date): Promise<NuphosDashboard | null> {
  for (const cadence of DASHBOARD_REFRESH_CADENCES) {
    const claimed = await nuphosDashboards().findOneAndUpdate(
      { cadence, nextRefreshAt: { $lte: now } },
      {
        $set: { nextRefreshAt: nextScheduledRefresh(cadence, now), lastScheduledRefreshAt: now },
      },
      { sort: { nextRefreshAt: 1 }, returnDocument: 'after' },
    )

    if (claimed) return claimed
  }

  return null
}

/** Claiming advances `nextRefreshAt` atomically, so concurrent replicas never
 *  refresh the same due dashboard twice, and a missed slot runs once, late. */
export async function runDueDashboardRefreshes(now = new Date()): Promise<number> {
  let refreshed = 0

  while (refreshed < MAX_REFRESHES_PER_SWEEP) {
    const dashboard = await claimDueDashboard(now)

    if (!dashboard) break
    refreshed += 1
    try {
      await refreshDashboard({ teamId: dashboard.teamId, dashboard, force: true })
    } catch (err) {
      logError('dashboard.scheduled_refresh.failed', err, {
        dashboard_id: dashboard._id.toHexString(),
      })
    }
  }
  if (refreshed > 0) logEvent('info', 'dashboard.scheduled_refresh.swept', { refreshed })

  return refreshed
}

let sweepTimer: ReturnType<typeof setInterval> | undefined
let migrationRerunTimer: ReturnType<typeof setTimeout> | undefined
let sweeping = false

function sweep(): void {
  if (sweeping) return
  sweeping = true
  void runDueDashboardRefreshes()
    .catch((err: unknown) => {
      logError('dashboard.scheduled_refresh.sweep_failed', err)
    })
    .finally(() => {
      sweeping = false
    })
}

function migrate(): Promise<void> {
  return migratePanelCadencesToDashboards().catch((err: unknown) => {
    logError('dashboard.cadence_migration.failed', err)
  })
}

export const dashboardRefreshScheduler = {
  async init(): Promise<void> {
    await migrate()
    migrationRerunTimer = setTimeout(() => void migrate(), MIGRATION_RERUN_DELAY_MS)
    sweepTimer = setInterval(sweep, SWEEP_INTERVAL_MS)
  },
  shutdown(): void {
    if (migrationRerunTimer) clearTimeout(migrationRerunTimer)
    if (sweepTimer) clearInterval(sweepTimer)
  },
}
