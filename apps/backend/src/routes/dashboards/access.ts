import { AppError } from '@/lib/errors'
import {
  canDeleteDashboard,
  canDo,
  canReadDashboard,
  canSetVisibility,
} from '@/lib/dashboards/visibility'
import { parseObjectId } from '@/lib/objectid'
import { dashboardPanels, nuphosDashboards } from '@/models'

import type { DashboardNeed, DashboardViewer } from '@/lib/dashboards/visibility'
import type { TeamAuthVariables } from '@/middleware/auth'
import type { DashboardPanel, DashboardVisibility, NuphosDashboard } from '@/models'
import type { ObjectId } from 'mongodb'

export const WRITE_ROLES = 'Requires one of: ADMINISTRATOR, EDITOR'

/** The member asking, as the visibility rules read them. */
export function viewerOf(c: {
  get(key: 'userId'): string
  get(key: 'teamRole'): TeamAuthVariables['teamRole']
}): DashboardViewer {
  return { userId: c.get('userId'), role: c.get('teamRole') }
}

/**
 * Throws unless `viewer` may do `need` with `dashboard`. Another member's personal
 * dashboard reads as not found, so its existence is not confirmed to anyone who
 * cannot read it, except an Administrator deleting it.
 */
export function assertDashboardAccess(
  dashboard: NuphosDashboard | null,
  viewer: DashboardViewer,
  need: DashboardNeed,
): asserts dashboard is NuphosDashboard {
  const reachable =
    dashboard !== null &&
    (canReadDashboard(dashboard, viewer) ||
      (need === 'delete' && canDeleteDashboard(dashboard, viewer)))

  if (!reachable) throw new AppError(404, 'dashboard_not_found', 'Dashboard not found')
  if (!canDo(dashboard, viewer, need)) throw new AppError(403, 'forbidden', WRITE_ROLES)
}

export async function loadDashboard(
  teamIdRaw: string,
  dashboardIdRaw: string,
  viewer: DashboardViewer,
  need: DashboardNeed = 'read',
): Promise<{ teamId: ObjectId; dashboard: NuphosDashboard }> {
  const teamId = parseObjectId(teamIdRaw, 'teamId')
  const dashboardId = parseObjectId(dashboardIdRaw, 'dashboardId')
  const dashboard = await nuphosDashboards().findOne({ _id: dashboardId, teamId })

  assertDashboardAccess(dashboard, viewer, need)

  return { teamId, dashboard }
}

export async function loadPanel(
  teamIdRaw: string,
  dashboardIdRaw: string,
  panelIdRaw: string,
  viewer: DashboardViewer,
  need: DashboardNeed = 'read',
): Promise<{ teamId: ObjectId; dashboard: NuphosDashboard; panel: DashboardPanel }> {
  const teamId = parseObjectId(teamIdRaw, 'teamId')
  const dashboardId = parseObjectId(dashboardIdRaw, 'dashboardId')
  const panelId = parseObjectId(panelIdRaw, 'panelId')
  const dashboard = await nuphosDashboards().findOne({ _id: dashboardId, teamId })

  // A panel is as visible, and as editable, as its dashboard.
  assertDashboardAccess(dashboard, viewer, need)
  const panel = await dashboardPanels().findOne({ _id: panelId, teamId, dashboardId })

  if (!panel) throw new AppError(404, 'panel_not_found', 'Panel not found')

  return { teamId, dashboard, panel }
}

/**
 * The visibility a dashboard update stores, or nothing when it does not change.
 * Only the creator changes it, and sharing it with the team takes a write role.
 */
export function visibilityUpdate(
  dashboard: NuphosDashboard,
  viewer: DashboardViewer,
  to: DashboardVisibility | undefined,
): DashboardVisibility | undefined {
  if (!to || to === (dashboard.visibility ?? 'team')) return undefined
  if (!canSetVisibility(dashboard, viewer, to)) {
    throw new AppError(
      403,
      'forbidden',
      "Only the dashboard's creator can change who sees it, and sharing it with the team requires one of: ADMINISTRATOR, EDITOR",
    )
  }

  return to
}
