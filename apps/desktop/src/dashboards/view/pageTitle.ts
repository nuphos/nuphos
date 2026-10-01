import type { NuphosDashboardRef } from '../../lib/appRoutes'

export const DASHBOARDS_TITLE = 'Dashboards'

export function dashboardsPageTitle({
  nuphosDashboard,
  nuphosDashboards,
  restoredTitle,
}: {
  nuphosDashboard: NuphosDashboardRef | null
  nuphosDashboards: { id: string; name: string }[] | undefined
  restoredTitle: string | undefined
}): string {
  if (!nuphosDashboard) return DASHBOARDS_TITLE

  const listed = nuphosDashboards?.find((d) => d.id === nuphosDashboard.dashboardId)

  if (listed) return listed.name
  // A restored ref carries the name from when it was pushed (or a URL
  // placeholder); the title persisted with the tab is fresher until the list loads.
  if (nuphosDashboards === undefined && restoredTitle) return restoredTitle

  return nuphosDashboard.dashboardName
}
