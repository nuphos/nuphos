import type { TeamRole } from '../../types'
import type { DashboardVisibility, NuphosDashboard } from '../schema'

/**
 * The backend's rules for who may change a dashboard, mirrored so the list offers
 * only what it will accept. A team dashboard is edited by Administrators and Editors;
 * a personal one by whoever holds it: its creator while they are in the team, and
 * once they are not, any Administrator. `creatorInTeam` is false only for a
 * dashboard the backend sent as a former member's.
 */
type Owned = Pick<NuphosDashboard, 'createdBy' | 'visibility'>

const writesTeam = (role: TeamRole | undefined) => role === 'ADMINISTRATOR' || role === 'EDITOR'

export function isPersonal(dashboard: Pick<NuphosDashboard, 'visibility'>): boolean {
  return dashboard.visibility === 'personal'
}

function holds(
  dashboard: Owned,
  userId: string | undefined,
  role: TeamRole | undefined,
  creatorInTeam: boolean,
) {
  return dashboard.createdBy === userId || (!creatorInTeam && role === 'ADMINISTRATOR')
}

export function canEditDashboard(
  dashboard: Owned,
  userId: string | undefined,
  role: TeamRole | undefined,
  creatorInTeam = true,
): boolean {
  return isPersonal(dashboard) ? holds(dashboard, userId, role, creatorInTeam) : writesTeam(role)
}

/**
 * Where this member may move a dashboard: a personal one they hold to the team
 * (which takes a team write role, since they could not edit it there otherwise), a
 * team one they created back to personal. Null when they may not move it.
 */
export function moveTarget(
  dashboard: Owned,
  userId: string | undefined,
  role: TeamRole | undefined,
  creatorInTeam = true,
): DashboardVisibility | null {
  if (!isPersonal(dashboard)) return dashboard.createdBy === userId ? 'personal' : null

  return holds(dashboard, userId, role, creatorInTeam) && writesTeam(role) ? 'team' : null
}

/** The list's two sections: the caller's personal dashboards, then the team's. */
export function splitByVisibility(dashboards: NuphosDashboard[]) {
  return {
    personal: dashboards.filter((dashboard) => isPersonal(dashboard)),
    team: dashboards.filter((dashboard) => !isPersonal(dashboard)),
  }
}
