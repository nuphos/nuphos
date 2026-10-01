import {
  nuphosDashboards,
  dashboardPanelAlerts,
  dashboardPanelInsights,
  dashboardPanels,
  dashboardPanelSnapshots,
} from '@/models/dashboards'
import {
  databaseChangeRequests,
  databaseConnections,
  databaseMetricSamples,
  databaseQueryAudits,
} from '@/models/database'
import {
  architectureDiagrams,
  fileTransferGroups,
  fileTransferItems,
  fileTransferAdmissions,
} from '@/models/diagrams'
import {
  asanaPendingOAuth,
  cloudflareOAuthResult,
  cloudflarePendingOAuth,
  gitlabPendingOAuth,
  jiraPendingOAuth,
  linearPendingOAuth,
  posthogPendingOAuth,
  sentryPendingOAuth,
  slackPendingOAuth,
} from '@/models/oauth'
import { teamByosBindings } from '@/models/team'

export async function setupCoreIndexes(): Promise<void> {
  // _id is auto-indexed; nothing to set up here.
  await gitlabPendingOAuth().createIndex(
    { expiresAt: 1 },
    { expireAfterSeconds: 0, name: 'gitlab_oauth_pending_ttl' },
  )
  await cloudflarePendingOAuth().createIndex(
    { expiresAt: 1 },
    { expireAfterSeconds: 0, name: 'cloudflare_oauth_pending_ttl' },
  )
  await cloudflareOAuthResult().createIndex(
    { expiresAt: 1 },
    { expireAfterSeconds: 0, name: 'cloudflare_oauth_result_ttl' },
  )
  await linearPendingOAuth().createIndex(
    { expiresAt: 1 },
    { expireAfterSeconds: 0, name: 'linear_oauth_pending_ttl' },
  )
  await jiraPendingOAuth().createIndex(
    { expiresAt: 1 },
    { expireAfterSeconds: 0, name: 'jira_oauth_pending_ttl' },
  )
  await asanaPendingOAuth().createIndex(
    { expiresAt: 1 },
    { expireAfterSeconds: 0, name: 'asana_oauth_pending_ttl' },
  )
  await sentryPendingOAuth().createIndex(
    { expiresAt: 1 },
    { expireAfterSeconds: 0, name: 'sentry_oauth_pending_ttl' },
  )
  await posthogPendingOAuth().createIndex(
    { expiresAt: 1 },
    { expireAfterSeconds: 0, name: 'posthog_oauth_pending_ttl' },
  )
  await slackPendingOAuth().createIndex(
    { expiresAt: 1 },
    { expireAfterSeconds: 0, name: 'slack_oauth_pending_ttl' },
  )
  // A Lark custom app (by app_id) can only be connected to one Nuphos team.
  await teamByosBindings().createIndex(
    { 'larkApps.appId': 1 },
    {
      unique: true,
      partialFilterExpression: { 'larkApps.appId': { $exists: true } },
      name: 'team_byos_lark_app_unique',
    },
  )
  // A Slack workspace can only be connected to one Nuphos team. The partial
  // filter keeps teams with no slackWorkspaces[] entries out of the index so
  // they don't collide on a null key.
  await teamByosBindings().createIndex(
    { 'slackWorkspaces.slackTeamId': 1 },
    {
      unique: true,
      partialFilterExpression: { 'slackWorkspaces.slackTeamId': { $exists: true } },
      name: 'team_byos_slack_workspace_unique',
    },
  )
  // A Huawei Cloud identity provider + trust agency can only be claimed by
  // one Nuphos team — Huawei authorizes the federation by that triple alone,
  // not by which team is asking, so a second team registering it could
  // otherwise assume the first team's credentials.
  await teamByosBindings().createIndex(
    {
      'huaweiAccounts.domainId': 1,
      'huaweiAccounts.idpId': 1,
      'huaweiAccounts.agencyName': 1,
    },
    {
      unique: true,
      partialFilterExpression: { 'huaweiAccounts.domainId': { $exists: true } },
      name: 'team_byos_huawei_account_unique',
    },
  )
  await databaseConnections().createIndex(
    { teamId: 1, name: 1 },
    { unique: true, name: 'database_connections_team_name_unique' },
  )
  await databaseConnections().createIndex(
    { teamId: 1, updatedAt: -1 },
    { name: 'database_connections_team_updatedAt' },
  )
  await databaseConnections().createIndex(
    {
      teamId: 1,
      'providerOrigin.provider': 1,
      'providerOrigin.product': 1,
      'providerOrigin.externalResourceId': 1,
    },
    {
      unique: true,
      partialFilterExpression: { 'providerOrigin.externalResourceId': { $exists: true } },
      name: 'database_connections_team_provider_resource_unique',
    },
  )
  await databaseQueryAudits().createIndex(
    { teamId: 1, connectionId: 1, createdAt: -1 },
    { name: 'database_query_audits_connection_createdAt' },
  )
  await databaseMetricSamples().createIndex(
    { teamId: 1, connectionId: 1, sampledAt: -1 },
    { name: 'database_metric_samples_connection_sampledAt' },
  )
  await databaseMetricSamples().createIndex(
    { expiresAt: 1 },
    { expireAfterSeconds: 0, name: 'database_metric_samples_ttl' },
  )
  await databaseChangeRequests().createIndex(
    { teamId: 1, connectionId: 1, createdAt: -1 },
    { name: 'database_change_requests_connection_createdAt' },
  )
  await databaseChangeRequests().createIndex(
    { teamId: 1, connectionId: 1, status: 1, updatedAt: -1 },
    { name: 'database_change_requests_connection_status_updatedAt' },
  )
  await databaseChangeRequests().createIndex(
    { executionId: 1 },
    {
      unique: true,
      partialFilterExpression: { executionId: { $type: 'string' } },
      name: 'database_change_requests_execution_id_unique',
    },
  )
  await architectureDiagrams().createIndex({ teamId: 1 }, { background: true })
  // ---- Dashboards (collections keep their cost_* names) ----
  await nuphosDashboards().createIndex({ teamId: 1, updatedAt: -1 }, { background: true })
  await nuphosDashboards().createIndex(
    { cadence: 1, nextRefreshAt: 1 },
    { partialFilterExpression: { nextRefreshAt: { $exists: true } }, background: true },
  )
  await dashboardPanels().createIndex({ dashboardId: 1 }, { background: true })
  await dashboardPanels().createIndex({ teamId: 1, _id: 1 }, { background: true })
  // Live-latest resolution: newest complete run for a panel.
  await dashboardPanelSnapshots().createIndex({ panelId: 1, requestedAt: -1 }, { background: true })
  // Preserve the last known-good output for the current script while a newer
  // refresh runs or fails.
  await dashboardPanelSnapshots().createIndex(
    { panelId: 1, codeHash: 1, status: 1, requestedAt: -1 },
    { background: true },
  )
  await dashboardPanelSnapshots().createIndex({ teamId: 1, _id: 1 }, { background: true })
  // Dedupe: identical script + params within a freshness window.
  await dashboardPanelSnapshots().createIndex(
    { panelId: 1, codeHash: 1, paramsHash: 1, status: 1 },
    { background: true },
  )
  // At most one equivalent execution may be in flight. Completed immutable
  // snapshots are excluded, so force-refresh can create another after finish.
  await dashboardPanelSnapshots().createIndex(
    { panelId: 1, codeHash: 1, paramsHash: 1 },
    {
      unique: true,
      partialFilterExpression: { status: 'running' },
      background: true,
      name: 'cost_panel_snapshots_running_unique',
    },
  )
  // TTL = billing retention, applied per-document via `expiresAt` (set at
  // insert to createdAt + retention). `expireAfterSeconds: 0` expires each doc
  // exactly at its own expiresAt.
  await dashboardPanelSnapshots().createIndex(
    { expiresAt: 1 },
    { expireAfterSeconds: 0, background: true, name: 'cost_panel_snapshots_ttl' },
  )
  await dashboardPanelInsights().createIndex({ snapshotId: 1 }, { background: true })
  await dashboardPanelInsights().createIndex({ panelId: 1, createdAt: -1 }, { background: true })
  await dashboardPanelInsights().createIndex(
    { status: 1, generationLeaseUntil: 1 },
    { background: true },
  )
  await dashboardPanelAlerts().createIndex({ panelId: 1 }, { unique: true, background: true })
  await dashboardPanelAlerts().createIndex({ teamId: 1, enabled: 1 }, { background: true })
  await fileTransferAdmissions().createIndex(
    { expiresAt: 1 },
    { expireAfterSeconds: 0, name: 'file_transfer_admission_ttl' },
  )
  await fileTransferGroups().createIndex(
    { expiresAt: 1 },
    { expireAfterSeconds: 0, name: 'file_transfer_groups_ttl' },
  )
  // Matches listTransferGroups: equality on teamId/userId/direction (+ optional
  // sessionId), sorted by createdAt. Two shapes cover the with/without-session
  // query paths.
  await fileTransferGroups().createIndex(
    { teamId: 1, userId: 1, direction: 1, createdAt: -1 },
    { background: true, name: 'file_transfer_groups_user_direction_createdAt' },
  )
  await fileTransferGroups().createIndex(
    { teamId: 1, userId: 1, direction: 1, sessionId: 1, createdAt: -1 },
    { background: true, name: 'file_transfer_groups_user_direction_session_createdAt' },
  )
  // Matches listSessionDownloadsSince (no userId — a plan-approval turn pushes
  // with the approver's token): equality on teamId/sessionId/direction, range +
  // sort on createdAt. Runs on every Slack agent turn.
  await fileTransferGroups().createIndex(
    { teamId: 1, sessionId: 1, direction: 1, createdAt: 1 },
    { background: true, name: 'file_transfer_groups_session_direction_createdAt' },
  )
  await fileTransferItems().createIndex(
    { expiresAt: 1 },
    { expireAfterSeconds: 0, name: 'file_transfer_items_ttl' },
  )
  await fileTransferItems().createIndex({ groupId: 1 }, { background: true })
}
