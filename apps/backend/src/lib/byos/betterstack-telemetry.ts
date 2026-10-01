import {
  attr,
  BetterStackApiError,
  betterStackPaginatedRequest,
  TELEMETRY_API_V1,
  TELEMETRY_API_V2,
} from './betterstack-core'

import type {
  BetterStackCollector,
  BetterStackDashboard,
  BetterStackMetric,
  BetterStackSource,
  BetterStackTelemetryHandle,
} from './betterstack-core'

export async function verifyBetterStackTelemetryToken(
  handle: BetterStackTelemetryHandle,
): Promise<void> {
  await listBetterStackSources(handle, { perPage: 1 })
}

export async function listBetterStackDashboards(
  handle: BetterStackTelemetryHandle,
  options: { perPage?: number } = {},
): Promise<BetterStackDashboard[]> {
  // Better Stack returns 404 (not an empty array) when the team has no
  // dashboards / the dashboards feature isn't provisioned — treat that as empty.
  const items = await betterStackPaginatedRequest<any>(
    TELEMETRY_API_V2,
    handle.telemetryApiToken,
    '/dashboards',
    { perPage: options.perPage },
  ).catch((err: unknown) => {
    if (err instanceof BetterStackApiError && err.status === 404) return [] as any[]
    throw err
  })

  return items.map((item) => {
    const a = attr(item)

    return {
      id: String(item.id),
      type: String(item.type ?? 'dashboard'),
      name: typeof a.name === 'string' ? a.name : null,
      createdAt: typeof a.created_at === 'string' ? a.created_at : null,
      updatedAt: typeof a.updated_at === 'string' ? a.updated_at : null,
    }
  })
}

export async function listBetterStackSources(
  handle: BetterStackTelemetryHandle,
  options: { perPage?: number } = {},
): Promise<BetterStackSource[]> {
  const items = await betterStackPaginatedRequest<any>(
    TELEMETRY_API_V1,
    handle.telemetryApiToken,
    '/sources',
    { perPage: options.perPage },
  )

  return items.map((item) => {
    const a = attr(item)

    return {
      id: String(item.id),
      type: String(item.type ?? 'source'),
      name: typeof a.name === 'string' ? a.name : null,
      teamName: typeof a.team_name === 'string' ? a.team_name : null,
      platform: typeof a.platform === 'string' ? a.platform : null,
      tableName: typeof a.table_name === 'string' ? a.table_name : null,
      ingestingHost: typeof a.ingesting_host === 'string' ? a.ingesting_host : null,
      ingestingPaused: a.ingesting_paused === true,
      logsRetention: typeof a.logs_retention === 'number' ? a.logs_retention : null,
      metricsRetention: typeof a.metrics_retention === 'number' ? a.metrics_retention : null,
      createdAt: typeof a.created_at === 'string' ? a.created_at : null,
      updatedAt: typeof a.updated_at === 'string' ? a.updated_at : null,
    }
  })
}

export async function listBetterStackCollectors(
  handle: BetterStackTelemetryHandle,
  options: { perPage?: number } = {},
): Promise<BetterStackCollector[]> {
  const items = await betterStackPaginatedRequest<any>(
    TELEMETRY_API_V1,
    handle.telemetryApiToken,
    '/collectors',
    { perPage: options.perPage },
  )

  return items.map((item) => {
    const a = attr(item)

    return {
      id: String(item.id),
      type: String(item.type ?? 'collector'),
      name: typeof a.name === 'string' ? a.name : null,
      platform: typeof a.platform === 'string' ? a.platform : null,
      status: typeof a.status === 'string' ? a.status : null,
      teamName: typeof a.team_name === 'string' ? a.team_name : null,
      dataRegion: typeof a.data_region === 'string' ? a.data_region : null,
      ingestingPaused: a.ingesting_paused === true,
      pingedAt: typeof a.pinged_at === 'string' ? a.pinged_at : null,
      createdAt: typeof a.created_at === 'string' ? a.created_at : null,
      updatedAt: typeof a.updated_at === 'string' ? a.updated_at : null,
    }
  })
}

export async function listBetterStackSourceMetrics(
  handle: BetterStackTelemetryHandle,
  sourceId: string,
): Promise<BetterStackMetric[]> {
  const items = await betterStackPaginatedRequest<any>(
    TELEMETRY_API_V2,
    handle.telemetryApiToken,
    `/sources/${encodeURIComponent(sourceId)}/metrics`,
    { perPage: 50 },
  )

  return items.map((item) => {
    const a = attr(item)

    return {
      id: String(item.id),
      type: String(item.type ?? 'metric'),
      name: typeof a.name === 'string' ? a.name : null,
      metricType: typeof a.type === 'string' ? a.type : null,
      aggregations: Array.isArray(a.aggregations) ? a.aggregations.map(String) : [],
    }
  })
}
