import { call } from './client'

export type BetterStackIntegration = {
  id: string
  label: string
  hasUptimeApiToken: boolean
  hasTelemetryApiToken: boolean
  createdAt: string
}

export type BetterStackMonitor = {
  id: string
  type: string
  url: string | null
  pronounceableName: string | null
  monitorType: string | null
  status: string | null
  checkFrequency: number | null
  teamName: string | null
  pausedAt: string | null
  createdAt: string | null
  updatedAt: string | null
}

export type BetterStackHeartbeat = {
  id: string
  type: string
  name: string | null
  status: string | null
  period: number | null
  grace: number | null
  pausedAt: string | null
  createdAt: string | null
  updatedAt: string | null
}

export type BetterStackSource = {
  id: string
  type: string
  name: string | null
  teamName: string | null
  platform: string | null
  tableName: string | null
  ingestingHost: string | null
  ingestingPaused: boolean
  logsRetention: number | null
  metricsRetention: number | null
  createdAt: string | null
  updatedAt: string | null
}

export type BetterStackCollector = {
  id: string
  type: string
  name: string | null
  platform: string | null
  status: string | null
  teamName: string | null
  dataRegion: string | null
  ingestingPaused: boolean
  pingedAt: string | null
  createdAt: string | null
  updatedAt: string | null
}

export type BetterStackIncident = {
  id: string
  type: string
  name: string | null
  cause: string | null
  status: string | null
  url: string | null
  httpMethod: string | null
  startedAt: string | null
  acknowledgedAt: string | null
  resolvedAt: string | null
}

export type BetterStackDashboard = {
  id: string
  type: string
  name: string | null
  createdAt: string | null
  updatedAt: string | null
}

export async function listBetterStackIntegrations(
  teamId: string,
): Promise<BetterStackIntegration[]> {
  const data = await call<{ integrations: BetterStackIntegration[] }>(
    'GET',
    `/teams/${teamId}/betterstack-integrations`,
  )

  return data.integrations ?? []
}

export async function bindBetterStackIntegration(
  teamId: string,
  label: string,
  uptimeApiToken: string | null,
  telemetryApiToken: string | null,
): Promise<BetterStackIntegration> {
  return call<BetterStackIntegration>(
    'POST',
    `/teams/${teamId}/betterstack-integrations`,
    {
      label,
      ...(uptimeApiToken ? { uptimeApiToken } : {}),
      ...(telemetryApiToken ? { telemetryApiToken } : {}),
    },
    { retry: false },
  )
}

export async function updateBetterStackIntegration(
  teamId: string,
  integrationId: string,
  patch: {
    label?: string
    uptimeApiToken?: string | null
    telemetryApiToken?: string | null
  },
): Promise<BetterStackIntegration> {
  return call<BetterStackIntegration>(
    'PATCH',
    `/teams/${teamId}/betterstack-integrations/${integrationId}`,
    patch,
    { retry: false },
  )
}

export async function unbindBetterStackIntegration(
  teamId: string,
  integrationId: string,
): Promise<void> {
  await call<void>(
    'DELETE',
    `/teams/${teamId}/betterstack-integrations/${integrationId}`,
    undefined,
    { retry: false },
  )
}

export async function listBetterStackMonitors(
  teamId: string,
  integrationId: string,
): Promise<BetterStackMonitor[]> {
  const data = await call<{ monitors: BetterStackMonitor[] }>(
    'GET',
    `/teams/${teamId}/betterstack-integrations/${integrationId}/uptime/monitors`,
  )

  return data.monitors ?? []
}

export async function listBetterStackHeartbeats(
  teamId: string,
  integrationId: string,
): Promise<BetterStackHeartbeat[]> {
  const data = await call<{ heartbeats: BetterStackHeartbeat[] }>(
    'GET',
    `/teams/${teamId}/betterstack-integrations/${integrationId}/uptime/heartbeats`,
  )

  return data.heartbeats ?? []
}

export async function listBetterStackIncidents(
  teamId: string,
  integrationId: string,
): Promise<BetterStackIncident[]> {
  const data = await call<{ incidents: BetterStackIncident[] }>(
    'GET',
    `/teams/${teamId}/betterstack-integrations/${integrationId}/uptime/incidents`,
  )

  return data.incidents ?? []
}

export async function listBetterStackDashboards(
  teamId: string,
  integrationId: string,
): Promise<BetterStackDashboard[]> {
  const data = await call<{ dashboards: BetterStackDashboard[] }>(
    'GET',
    `/teams/${teamId}/betterstack-integrations/${integrationId}/telemetry/dashboards`,
  )

  return data.dashboards ?? []
}

export async function listBetterStackSources(
  teamId: string,
  integrationId: string,
): Promise<BetterStackSource[]> {
  const data = await call<{ sources: BetterStackSource[] }>(
    'GET',
    `/teams/${teamId}/betterstack-integrations/${integrationId}/telemetry/sources`,
  )

  return data.sources ?? []
}

export async function listBetterStackCollectors(
  teamId: string,
  integrationId: string,
): Promise<BetterStackCollector[]> {
  const data = await call<{ collectors: BetterStackCollector[] }>(
    'GET',
    `/teams/${teamId}/betterstack-integrations/${integrationId}/telemetry/collectors`,
  )

  return data.collectors ?? []
}

export async function deleteBetterStackMonitorById(
  teamId: string,
  integrationId: string,
  monitorId: string,
): Promise<void> {
  await call<void>(
    'DELETE',
    `/teams/${teamId}/betterstack-integrations/${integrationId}/uptime/monitors/${encodeURIComponent(monitorId)}`,
  )
}

export async function deleteBetterStackHeartbeatById(
  teamId: string,
  integrationId: string,
  heartbeatId: string,
): Promise<void> {
  await call<void>(
    'DELETE',
    `/teams/${teamId}/betterstack-integrations/${integrationId}/uptime/heartbeats/${encodeURIComponent(heartbeatId)}`,
  )
}

// ---------------------------------------------------------------------------
// Permission-grant proposals (agent proposes → admin approves → backend executes)
// ---------------------------------------------------------------------------
