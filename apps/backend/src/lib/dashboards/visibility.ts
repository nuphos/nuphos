import type { NuphosTeamRole } from '@/lib/identity/types'
import type { DashboardVisibility, NuphosDashboard } from '@/models'

/** Who is asking: the member and their role in the dashboard's team. */
export type DashboardViewer = { userId: string; role: NuphosTeamRole }

/** What the caller needs to do with a dashboard. */
export type DashboardNeed = 'read' | 'edit' | 'delete'

type Owned = Pick<NuphosDashboard, 'createdBy' | 'visibility'>

const writesTeam = (role: NuphosTeamRole) => role === 'ADMINISTRATOR' || role === 'EDITOR'

export function isPersonal(dashboard: Pick<NuphosDashboard, 'visibility'>): boolean {
  return dashboard.visibility === 'personal'
}

/** A team dashboard is the team's; a personal one only its creator's. */
export function canReadDashboard(dashboard: Owned, viewer: DashboardViewer): boolean {
  return !isPersonal(dashboard) || dashboard.createdBy === viewer.userId
}

/** A team dashboard is edited by Administrators and Editors; a personal one by its creator, whatever their role. */
export function canEditDashboard(dashboard: Owned, viewer: DashboardViewer): boolean {
  return isPersonal(dashboard) ? dashboard.createdBy === viewer.userId : writesTeam(viewer.role)
}

/** Whoever may edit it, and an Administrator for anyone's personal dashboard, which they cannot read. */
export function canDeleteDashboard(dashboard: Owned, viewer: DashboardViewer): boolean {
  return (
    canEditDashboard(dashboard, viewer) ||
    (isPersonal(dashboard) && viewer.role === 'ADMINISTRATOR')
  )
}

export function canDo(dashboard: Owned, viewer: DashboardViewer, need: DashboardNeed): boolean {
  if (need === 'read') return canReadDashboard(dashboard, viewer)

  return need === 'edit'
    ? canEditDashboard(dashboard, viewer)
    : canDeleteDashboard(dashboard, viewer)
}

/**
 * Only the creator moves a dashboard between personal and team. Sharing makes it
 * a team dashboard, which only Administrators and Editors edit, so it needs one of
 * those roles; making it personal again does not.
 */
export function canSetVisibility(
  dashboard: Owned,
  viewer: DashboardViewer,
  to: DashboardVisibility,
): boolean {
  if (dashboard.createdBy !== viewer.userId) return false

  return to === 'personal' || writesTeam(viewer.role)
}

/** Creating a team dashboard takes the team write roles; a personal one, any member. */
export function canCreateDashboard(viewer: DashboardViewer, visibility: DashboardVisibility) {
  return visibility === 'personal' || writesTeam(viewer.role)
}

/**
 * The dashboards the list returns in full: every team dashboard and the caller's own
 * personal ones. A dashboard with no visibility stored is a team dashboard.
 */
export function readableFilter(viewer: DashboardViewer) {
  return { $or: [{ visibility: { $ne: 'personal' as const } }, { createdBy: viewer.userId }] }
}
