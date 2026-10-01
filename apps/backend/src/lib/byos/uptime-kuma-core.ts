export type UptimeKumaAuthHandle = {
  baseUrl: string
  username?: string
  password?: string
  authToken?: string
}

export type UptimeKumaMonitor = {
  id: number
  name?: string
  type?: string
  url?: string
  active?: boolean
  interval?: number
  retryInterval?: number
  resendInterval?: number
  maxretries?: number
  accepted_statuscodes?: string[]
  status?: string | number
  parent?: string | number | null
  childrenIDs?: (string | number)[]
  weight?: string | number
  pathName?: string
  tags?: unknown[]
}

export type UptimeKumaRawMonitor = Record<string, unknown> & { id: unknown }

export class UptimeKumaApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'UptimeKumaApiError'
  }
}

export type KumaAck = {
  ok?: boolean
  msg?: string
  msgi18n?: boolean
  tokenRequired?: boolean
  token?: string
  monitorID?: number
  monitor?: UptimeKumaRawMonitor
}

export const SOCKET_TIMEOUT_MS = 20_000

export function isUptimeKumaMonitor(value: unknown): value is UptimeKumaRawMonitor {
  return Boolean(
    value &&
    typeof value === 'object' &&
    Number.isInteger(Number((value as Record<string, unknown>).id)),
  )
}

const PUBLIC_MONITOR_FIELDS = [
  'name',
  'type',
  'url',
  'active',
  'interval',
  'retryInterval',
  'resendInterval',
  'maxretries',
  'accepted_statuscodes',
  'status',
  'parent',
  'childrenIDs',
  'weight',
  'pathName',
  'tags',
] as const

export function sanitizeUptimeKumaMonitor(value: UptimeKumaRawMonitor): UptimeKumaMonitor {
  const monitor: Record<string, unknown> = { id: Number(value.id) }

  for (const field of PUBLIC_MONITOR_FIELDS) {
    if (value[field] !== undefined) monitor[field] = value[field]
  }

  return monitor as UptimeKumaMonitor
}

export function sanitizeUptimeKumaMonitorList(
  payload: Record<string, UptimeKumaRawMonitor> | null | undefined,
): UptimeKumaMonitor[] {
  return Object.values(payload ?? {})
    .filter(isUptimeKumaMonitor)
    .map(sanitizeUptimeKumaMonitor)
    .sort((a, b) => a.id - b.id)
}
