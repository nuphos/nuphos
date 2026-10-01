import { nextCronRun } from '@/lib/cron'
import { nuphosDashboards } from '@/models'

import type { DashboardRefreshCadence, NuphosDashboard } from '@/models'

const CADENCE_CRON: Record<DashboardRefreshCadence, string> = {
  daily: '0 9 * * *',
  weekly: '0 9 * * 1',
  monthly: '0 9 1 * *',
}

/** Most frequent first. */
export const DASHBOARD_REFRESH_CADENCES: DashboardRefreshCadence[] = ['daily', 'weekly', 'monthly']

export function nextScheduledRefresh(cadence: DashboardRefreshCadence, after: Date): Date {
  return nextCronRun(CADENCE_CRON[cadence], after)
}

/** The fields that arm (or, for null, clear) a dashboard's refresh schedule.
 *  Empty when the cadence is unchanged, so an overdue slot is kept for the sweeper. */
export function dashboardCadenceUpdate(
  dashboard: Pick<NuphosDashboard, 'cadence'>,
  cadence: DashboardRefreshCadence | null,
  now = new Date(),
): { set: Partial<NuphosDashboard>; unset: Record<string, ''> } {
  if (cadence === (dashboard.cadence ?? null)) return { set: {}, unset: {} }

  return cadence
    ? { set: { cadence, nextRefreshAt: nextScheduledRefresh(cadence, now) }, unset: {} }
    : { set: {}, unset: { cadence: '', nextRefreshAt: '' } }
}

export async function setDashboardCadence(
  dashboard: NuphosDashboard,
  cadence: DashboardRefreshCadence | null | undefined,
): Promise<NuphosDashboard> {
  if (cadence === undefined) return dashboard
  const { set, unset } = dashboardCadenceUpdate(dashboard, cadence)

  if (!Object.keys(set).length && !Object.keys(unset).length) return dashboard
  const updated = await nuphosDashboards().findOneAndUpdate(
    { _id: dashboard._id, teamId: dashboard.teamId },
    Object.keys(unset).length ? { $set: set, $unset: unset } : { $set: set },
    { returnDocument: 'after' },
  )

  return updated ?? dashboard
}
