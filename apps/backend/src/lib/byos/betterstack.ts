import {
  attr,
  betterStackPaginatedRequest,
  betterStackRequest,
  UPTIME_API,
  UPTIME_API_V3,
} from './betterstack-core'

import type {
  BetterStackHeartbeat,
  BetterStackIncident,
  BetterStackMonitor,
  BetterStackMonitorInput,
  BetterStackOutgoingWebhook,
  BetterStackUptimeHandle,
} from './betterstack-core'

export { BetterStackApiError, betterStackApiErrorMessage } from './betterstack-core'
export type {
  BetterStackCollector,
  BetterStackDashboard,
  BetterStackHeartbeat,
  BetterStackIncident,
  BetterStackMetric,
  BetterStackMonitor,
  BetterStackMonitorInput,
  BetterStackOutgoingWebhook,
  BetterStackSource,
  BetterStackTelemetryHandle,
  BetterStackUptimeHandle,
} from './betterstack-core'
export {
  listBetterStackCollectors,
  listBetterStackDashboards,
  listBetterStackSourceMetrics,
  listBetterStackSources,
  verifyBetterStackTelemetryToken,
} from './betterstack-telemetry'

export async function verifyBetterStackUptimeToken(handle: BetterStackUptimeHandle): Promise<void> {
  await listBetterStackMonitors(handle, { perPage: 1 })
}

export async function listBetterStackMonitors(
  handle: BetterStackUptimeHandle,
  options: { perPage?: number } = {},
): Promise<BetterStackMonitor[]> {
  const items = await betterStackPaginatedRequest<any>(
    UPTIME_API,
    handle.uptimeApiToken,
    '/monitors',
    { perPage: options.perPage },
  )

  return items.map((item) => {
    const a = attr(item)

    return {
      id: String(item.id),
      type: String(item.type ?? 'monitor'),
      url: typeof a.url === 'string' ? a.url : null,
      pronounceableName: typeof a.pronounceable_name === 'string' ? a.pronounceable_name : null,
      monitorType: typeof a.monitor_type === 'string' ? a.monitor_type : null,
      status: typeof a.status === 'string' ? a.status : null,
      checkFrequency: typeof a.check_frequency === 'number' ? a.check_frequency : null,
      teamName: typeof a.team_name === 'string' ? a.team_name : null,
      pausedAt: typeof a.paused_at === 'string' ? a.paused_at : null,
      createdAt: typeof a.created_at === 'string' ? a.created_at : null,
      updatedAt: typeof a.updated_at === 'string' ? a.updated_at : null,
    }
  })
}

function outgoingWebhook(item: any): BetterStackOutgoingWebhook {
  const a = attr(item)

  return {
    id: String(item.id),
    name: typeof a.name === 'string' ? a.name : null,
    url: typeof a.url === 'string' ? a.url : null,
    triggerType: typeof a.trigger_type === 'string' ? a.trigger_type : null,
  }
}

export async function listBetterStackOutgoingWebhooks(
  handle: BetterStackUptimeHandle,
): Promise<BetterStackOutgoingWebhook[]> {
  const items = await betterStackPaginatedRequest<any>(
    UPTIME_API,
    handle.uptimeApiToken,
    '/outgoing-webhooks',
  )

  return items.map(outgoingWebhook)
}

export async function getBetterStackOutgoingWebhook(
  handle: BetterStackUptimeHandle,
  outgoingWebhookId: string,
): Promise<BetterStackOutgoingWebhook> {
  const item = await betterStackRequest<any>(
    UPTIME_API,
    handle.uptimeApiToken,
    `/outgoing-webhooks/${encodeURIComponent(outgoingWebhookId)}`,
  )

  return outgoingWebhook(item)
}

export async function deleteBetterStackOutgoingWebhook(
  handle: BetterStackUptimeHandle,
  outgoingWebhookId: string,
): Promise<void> {
  await betterStackRequest<void>(
    UPTIME_API,
    handle.uptimeApiToken,
    `/outgoing-webhooks/${encodeURIComponent(outgoingWebhookId)}`,
    { method: 'DELETE' },
  )
}

function monitorPayload(input: BetterStackMonitorInput): Record<string, unknown> {
  return {
    ...(input.url !== undefined ? { url: input.url } : {}),
    ...(input.pronounceableName !== undefined
      ? { pronounceable_name: input.pronounceableName }
      : {}),
    ...(input.monitorType !== undefined ? { monitor_type: input.monitorType } : {}),
    ...(input.checkFrequency !== undefined ? { check_frequency: input.checkFrequency } : {}),
    ...(input.requestTimeout !== undefined ? { request_timeout: input.requestTimeout } : {}),
    ...(input.httpMethod !== undefined ? { http_method: input.httpMethod } : {}),
    ...(input.expectedStatusCodes !== undefined
      ? { expected_status_codes: input.expectedStatusCodes }
      : {}),
    ...(input.requiredKeyword !== undefined ? { required_keyword: input.requiredKeyword } : {}),
    ...(input.verifySsl !== undefined ? { verify_ssl: input.verifySsl } : {}),
    ...(input.teamName !== undefined ? { team_name: input.teamName } : {}),
  }
}

export async function createBetterStackMonitor(
  handle: BetterStackUptimeHandle,
  input: BetterStackMonitorInput,
): Promise<unknown> {
  return betterStackRequest(UPTIME_API, handle.uptimeApiToken, '/monitors', {
    method: 'POST',
    body: JSON.stringify(monitorPayload(input)),
  })
}

export async function updateBetterStackMonitor(
  handle: BetterStackUptimeHandle,
  monitorId: string,
  input: BetterStackMonitorInput,
): Promise<unknown> {
  return betterStackRequest(
    UPTIME_API,
    handle.uptimeApiToken,
    `/monitors/${encodeURIComponent(monitorId)}`,
    {
      method: 'PATCH',
      body: JSON.stringify(monitorPayload(input)),
    },
  )
}

export async function deleteBetterStackMonitor(
  handle: BetterStackUptimeHandle,
  monitorId: string,
): Promise<void> {
  await betterStackRequest(
    UPTIME_API,
    handle.uptimeApiToken,
    `/monitors/${encodeURIComponent(monitorId)}`,
    {
      method: 'DELETE',
    },
  )
}

export async function deleteBetterStackHeartbeat(
  handle: BetterStackUptimeHandle,
  heartbeatId: string,
): Promise<void> {
  await betterStackRequest(
    UPTIME_API,
    handle.uptimeApiToken,
    `/heartbeats/${encodeURIComponent(heartbeatId)}`,
    {
      method: 'DELETE',
    },
  )
}

export async function listBetterStackHeartbeats(
  handle: BetterStackUptimeHandle,
  options: { perPage?: number } = {},
): Promise<BetterStackHeartbeat[]> {
  const items = await betterStackPaginatedRequest<any>(
    UPTIME_API,
    handle.uptimeApiToken,
    '/heartbeats',
    { perPage: options.perPage },
  )

  return items.map((item) => {
    const a = attr(item)

    return {
      id: String(item.id),
      type: String(item.type ?? 'heartbeat'),
      name: typeof a.name === 'string' ? a.name : null,
      status: typeof a.status === 'string' ? a.status : null,
      period: typeof a.period === 'number' ? a.period : null,
      grace: typeof a.grace === 'number' ? a.grace : null,
      pausedAt: typeof a.paused_at === 'string' ? a.paused_at : null,
      createdAt: typeof a.created_at === 'string' ? a.created_at : null,
      updatedAt: typeof a.updated_at === 'string' ? a.updated_at : null,
    }
  })
}

export async function listBetterStackIncidents(
  handle: BetterStackUptimeHandle,
  options: { perPage?: number } = {},
): Promise<BetterStackIncident[]> {
  const items = await betterStackPaginatedRequest<any>(
    UPTIME_API_V3,
    handle.uptimeApiToken,
    '/incidents',
    { perPage: options.perPage ?? 50 },
  )

  return items.map((item) => {
    const a = attr(item)
    const acknowledgedAt = typeof a.acknowledged_at === 'string' ? a.acknowledged_at : null
    const resolvedAt = typeof a.resolved_at === 'string' ? a.resolved_at : null

    return {
      id: String(item.id),
      type: String(item.type ?? 'incident'),
      name: typeof a.name === 'string' ? a.name : null,
      cause: typeof a.cause === 'string' ? a.cause : null,
      status:
        typeof a.status === 'string'
          ? a.status
          : resolvedAt
            ? 'resolved'
            : acknowledgedAt
              ? 'acknowledged'
              : 'ongoing',
      url: typeof a.url === 'string' ? a.url : null,
      httpMethod: typeof a.http_method === 'string' ? a.http_method : null,
      startedAt: typeof a.started_at === 'string' ? a.started_at : null,
      acknowledgedAt,
      resolvedAt,
    }
  })
}
