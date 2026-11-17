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

/**
 * Who holds a personal dashboard: its creator while they are in the team, and once
 * they are not, any Administrator, who can then take it over. `creatorInTeam` only
 * matters for that case; a caller that has not looked it up passes nothing.
 */
function holdsPersonal(dashboard: Owned, viewer: DashboardViewer, creatorInTeam: boolean) {
  return (
    dashboard.createdBy === viewer.userId || (!creatorInTeam && viewer.role === 'ADMINISTRATOR')
  )
}

/** A team dashboard is the team's; a personal one only its holder's. */
export function canReadDashboard(
  dashboard: Owned,
  viewer: DashboardViewer,
  creatorInTeam = true,
): boolean {
  return !isPersonal(dashboard) || holdsPersonal(dashboard, viewer, creatorInTeam)
}

/** A team dashboard is edited by Administrators and Editors; a personal one by its holder, whatever their role. */
export function canEditDashboard(
  dashboard: Owned,
  viewer: DashboardViewer,
  creatorInTeam = true,
): boolean {
  return isPersonal(dashboard)
    ? holdsPersonal(dashboard, viewer, creatorInTeam)
    : writesTeam(viewer.role)
}

/** Deleting takes what editing takes. */
export const canDeleteDashboard = canEditDashboard

export function canDo(
  dashboard: Owned,
  viewer: DashboardViewer,
  need: DashboardNeed,
  creatorInTeam = true,
): boolean {
  return need === 'read'
    ? canReadDashboard(dashboard, viewer, creatorInTeam)
    : canEditDashboard(dashboard, viewer, creatorInTeam)
}

/**
 * Moving a dashboard between personal and team. Sharing a personal one takes its
 * holder, with a team write role, since a team dashboard is only edited by those.
 * Making a team dashboard personal again takes its creator.
 */
export function canSetVisibility(
  dashboard: Owned,
  viewer: DashboardViewer,
  to: DashboardVisibility,
  creatorInTeam = true,
): boolean {
  if (to === 'personal') return dashboard.createdBy === viewer.userId

  return holdsPersonal(dashboard, viewer, creatorInTeam) && writesTeam(viewer.role)
}

/** Creating a team dashboard takes the team write roles; a personal one, any member. */
export function canCreateDashboard(viewer: DashboardViewer, visibility: DashboardVisibility) {
  return visibility === 'personal' || writesTeam(viewer.role)
}

/**
 * The dashboards the list returns for a member: every team dashboard and their own
 * personal ones. A dashboard with no visibility stored is a team dashboard.
 */
export function readableFilter(viewer: DashboardViewer) {
  return { $or: [{ visibility: { $ne: 'personal' as const } }, { createdBy: viewer.userId }] }
}
