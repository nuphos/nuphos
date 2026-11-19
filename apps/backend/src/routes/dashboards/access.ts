import { currentMemberIds } from '@/lib/dashboards/members'
import { canDo, canReadDashboard, canSetVisibility, isPersonal } from '@/lib/dashboards/visibility'
import { AppError } from '@/lib/errors'
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
 * Whether a personal dashboard's creator is still in the team. Only an Administrator
 * looking at another member's personal dashboard needs it, since that is the one
 * case it changes; everyone else gets true without a lookup.
 */
async function creatorInTeam(
  teamId: ObjectId,
  dashboard: NuphosDashboard | null,
  viewer: DashboardViewer,
) {
  if (!dashboard || !isPersonal(dashboard) || dashboard.createdBy === viewer.userId) return true
  if (viewer.role !== 'ADMINISTRATOR') return true

  return (await currentMemberIds(teamId)).has(dashboard.createdBy)
}

/**
 * Throws unless `viewer` may do `need` with `dashboard`. A personal dashboard that
 * `viewer` does not hold reads as not found, so its existence is not confirmed.
 */
export function assertDashboardAccess(
  dashboard: NuphosDashboard | null,
  viewer: DashboardViewer,
  need: DashboardNeed,
  inTeam = true,
): asserts dashboard is NuphosDashboard {
  if (!dashboard || !canReadDashboard(dashboard, viewer, inTeam)) {
    throw new AppError(404, 'dashboard_not_found', 'Dashboard not found')
  }
  if (!canDo(dashboard, viewer, need, inTeam)) throw new AppError(403, 'forbidden', WRITE_ROLES)
}

export async function loadDashboard(
  teamIdRaw: string,
  dashboardIdRaw: string,
  viewer: DashboardViewer,
  need: DashboardNeed = 'read',
): Promise<{ teamId: ObjectId; dashboard: NuphosDashboard; inTeam: boolean }> {
  const teamId = parseObjectId(teamIdRaw, 'teamId')
  const dashboardId = parseObjectId(dashboardIdRaw, 'dashboardId')
  const dashboard = await nuphosDashboards().findOne({ _id: dashboardId, teamId })
  const inTeam = await creatorInTeam(teamId, dashboard, viewer)

  assertDashboardAccess(dashboard, viewer, need, inTeam)

  return { teamId, dashboard, inTeam }
}

export async function loadPanel(
  teamIdRaw: string,
  dashboardIdRaw: string,
  panelIdRaw: string,
  viewer: DashboardViewer,
  need: DashboardNeed = 'read',
): Promise<{
  teamId: ObjectId
  dashboard: NuphosDashboard
  panel: DashboardPanel
  inTeam: boolean
}> {
  const teamId = parseObjectId(teamIdRaw, 'teamId')
  const dashboardId = parseObjectId(dashboardIdRaw, 'dashboardId')
  const panelId = parseObjectId(panelIdRaw, 'panelId')
  const dashboard = await nuphosDashboards().findOne({ _id: dashboardId, teamId })
  const inTeam = await creatorInTeam(teamId, dashboard, viewer)

  // A panel is as visible, and as editable, as its dashboard.
  assertDashboardAccess(dashboard, viewer, need, inTeam)
  const panel = await dashboardPanels().findOne({ _id: panelId, teamId, dashboardId })

  if (!panel) throw new AppError(404, 'panel_not_found', 'Panel not found')

  return { teamId, dashboard, panel, inTeam }
}

/**
 * The visibility a dashboard update stores, or nothing when it does not change.
 * Sharing takes the dashboard's holder with a team write role; making it personal
 * again takes its creator.
 */
export function visibilityUpdate(
  dashboard: NuphosDashboard,
  viewer: DashboardViewer,
  to: DashboardVisibility | undefined,
  inTeam = true,
): DashboardVisibility | undefined {
  if (!to || to === (dashboard.visibility ?? 'team')) return undefined
  if (!canSetVisibility(dashboard, viewer, to, inTeam)) {
    throw new AppError(
      403,
      'forbidden',
      to === 'team'
        ? 'Sharing a personal dashboard with the team takes its holder, with one of: ADMINISTRATOR, EDITOR'
        : "Only the dashboard's creator can make it personal",
    )
  }

  return to
}
