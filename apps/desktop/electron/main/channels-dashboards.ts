import * as atlas from '../atlas'

import type { DashboardViewRange } from '../../src/dashboards/schema'

// Dashboards: the list (and, for an Administrator, those left by former members),
// a dashboard and its refresh, its panels, and their alerts.
export const dashboardChannels = {
  'dashboards:list': (_e: unknown, teamId: string) => atlas.dashboardsList(teamId),
  'dashboards:former-members': (_e: unknown, teamId: string) =>
    atlas.dashboardsFormerMembers(teamId),
  'dashboards:create': (_e: unknown, teamId: string, input: unknown) =>
    atlas.dashboardsCreate(teamId, input),
  'dashboards:get': (
    _e: unknown,
    teamId: string,
    dashboardId: string,
    viewRange?: DashboardViewRange,
  ) => atlas.dashboardsGet(teamId, dashboardId, viewRange),
  'dashboards:update': (_e: unknown, teamId: string, dashboardId: string, input: unknown) =>
    atlas.dashboardsUpdate(teamId, dashboardId, input),
  'dashboards:delete': (_e: unknown, teamId: string, dashboardId: string) =>
    atlas.dashboardsDelete(teamId, dashboardId),
  'dashboards:refresh': (
    _e: unknown,
    teamId: string,
    dashboardId: string,
    force?: boolean,
    viewRange?: DashboardViewRange,
  ) => atlas.dashboardsRefresh(teamId, dashboardId, force, viewRange),
  'dashboards:createPanel': (_e: unknown, teamId: string, dashboardId: string, input: unknown) =>
    atlas.dashboardsCreatePanel(teamId, dashboardId, input),
  'dashboards:updatePanel': (
    _e: unknown,
    teamId: string,
    dashboardId: string,
    panelId: string,
    input: unknown,
  ) => atlas.dashboardsUpdatePanel(teamId, dashboardId, panelId, input),
  'dashboards:deletePanel': (_e: unknown, teamId: string, dashboardId: string, panelId: string) =>
    atlas.dashboardsDeletePanel(teamId, dashboardId, panelId),
  'dashboards:executePanel': (
    _e: unknown,
    teamId: string,
    dashboardId: string,
    panelId: string,
    force?: boolean,
    viewRange?: DashboardViewRange,
  ) => atlas.dashboardsExecutePanel(teamId, dashboardId, panelId, force, viewRange),
  'dashboards:getAlert': (_e: unknown, teamId: string, dashboardId: string, panelId: string) =>
    atlas.dashboardsGetAlert(teamId, dashboardId, panelId),
  'dashboards:saveAlert': (
    _e: unknown,
    teamId: string,
    dashboardId: string,
    panelId: string,
    input: unknown,
  ) => atlas.dashboardsSaveAlert(teamId, dashboardId, panelId, input),
  'dashboards:deleteAlert': (_e: unknown, teamId: string, dashboardId: string, panelId: string) =>
    atlas.dashboardsDeleteAlert(teamId, dashboardId, panelId),
}
