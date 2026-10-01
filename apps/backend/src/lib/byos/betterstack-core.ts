export const UPTIME_API = 'https://uptime.betterstack.com/api/v2'
// Incidents moved to v3; v2 is deprecated for them. Dashboards live in the
// Telemetry product, not Uptime — they use the telemetry token.
export const UPTIME_API_V3 = 'https://uptime.betterstack.com/api/v3'
export const TELEMETRY_API_V1 = 'https://telemetry.betterstack.com/api/v1'
export const TELEMETRY_API_V2 = 'https://telemetry.betterstack.com/api/v2'

type BetterStackPagination = {
  next?: string | null
}

type BetterStackResponse<T> = {
  data?: T
  pagination?: BetterStackPagination
  /** Better Stack endpoints return both JSON:API arrays and keyed validation objects. */
  errors?: unknown
  error?: unknown
  message?: unknown
}

export type BetterStackUptimeHandle = { uptimeApiToken: string }
export type BetterStackTelemetryHandle = { telemetryApiToken: string }

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

export type BetterStackOutgoingWebhook = {
  id: string
  name: string | null
  url: string | null
  triggerType: string | null
}

export type BetterStackMonitorInput = {
  url?: string
  pronounceableName?: string
  monitorType?: string
  checkFrequency?: number
  requestTimeout?: number
  httpMethod?: string
  expectedStatusCodes?: number[]
  requiredKeyword?: string
  verifySsl?: boolean
  teamName?: string
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

export type BetterStackMetric = {
  id: string
  type: string
  name: string | null
  metricType: string | null
  aggregations: string[]
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

export class BetterStackApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'BetterStackApiError'
  }
}

function errorText(value: unknown, depth = 0): string | undefined {
  if (depth > 5) return undefined
  if (typeof value === 'string') {
    const text = value.trim()

    return text || undefined
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const text = errorText(item, depth + 1)

      if (text) return text
    }

    return undefined
  }
  if (!value || typeof value !== 'object') return undefined

  const record = value as Record<string, unknown>

  for (const key of ['detail', 'message', 'title', 'error', 'errors']) {
    const text = errorText(record[key], depth + 1)

    if (text) return text
  }
  // Keyed validation errors use field names as keys and arrays of strings as
  // values. Only inspect values so provider field names are not mistaken for
  // the actual error message.
  for (const item of Object.values(record)) {
    const text = errorText(item, depth + 1)

    if (text) return text
  }

  return undefined
}

export function betterStackApiErrorMessage(payload: unknown, status: number): string {
  if (payload && typeof payload === 'object') {
    const response = payload as BetterStackResponse<unknown>
    const text =
      errorText(response.errors) ?? errorText(response.error) ?? errorText(response.message)

    if (text) return text.slice(0, 500)
  }

  return `Better Stack API returned HTTP ${String(status)}`
}

export async function betterStackRequest<T>(
  baseUrl: string,
  token: string,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const headers = new Headers(init.headers)

  headers.set('Accept', 'application/json')
  headers.set('Authorization', `Bearer ${token}`)
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')

  const res = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers,
    signal: AbortSignal.timeout(20_000),
  })

  if (res.status === 204) return undefined as T

  let payload: BetterStackResponse<T> | null = null

  try {
    payload = (await res.json()) as BetterStackResponse<T>
  } catch {
    // Use the HTTP status fallback below.
  }

  if (!res.ok) {
    throw new BetterStackApiError(res.status, betterStackApiErrorMessage(payload, res.status))
  }
  if (payload?.data === undefined) {
    throw new BetterStackApiError(res.status, 'Better Stack API returned an empty response')
  }

  return payload.data as T
}

export async function betterStackPaginatedRequest<T>(
  baseUrl: string,
  token: string,
  path: string,
  options: { perPage?: number; maxPages?: number } = {},
): Promise<T[]> {
  const results: T[] = []
  const perPage = options.perPage ?? 50
  const maxPages = options.maxPages ?? 100
  let page = 1

  for (;;) {
    const sep = path.includes('?') ? '&' : '?'
    const payload = await betterStackRequest<T[]>(
      baseUrl,
      token,
      `${path}${sep}page=${String(page)}&per_page=${String(perPage)}`,
    )

    results.push(...payload)
    if (payload.length < perPage) break
    if (page >= maxPages) {
      throw new BetterStackApiError(
        502,
        `Better Stack pagination exceeded ${String(maxPages)} pages`,
      )
    }
    page += 1
  }

  return results
}

export function attr<T extends Record<string, unknown>>(item: { attributes?: T }): T {
  return item.attributes ?? ({} as T)
}
