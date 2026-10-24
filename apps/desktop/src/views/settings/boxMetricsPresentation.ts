import type { DeviceMetrics, DeviceMetricsStatus } from '../../api/device-types'

/** `creating` while a Box is still being made, `connecting` while its machine waits for its host. */
export type MetricsStatus = DeviceMetricsStatus | 'creating' | 'connecting'

const STATUS_LABEL: Record<MetricsStatus, string> = {
  creating: 'Starting',
  connecting: 'Waiting for the host',
  offline: 'Host offline',
  unsupported: 'No metrics on this host',
  waiting: 'Waiting for metrics',
  stale: 'Stale reading',
  live: 'Live',
}

const gib = (bytes: number) => (bytes / 1024 ** 3).toFixed(1).replace(/\.0$/u, '')
const share = (value: { used: number; total: number }) => (value.used / value.total) * 100

function validCapacity(value: unknown): value is DeviceMetrics['memory'] {
  if (!value || typeof value !== 'object') return false
  const { used, total } = value as Partial<DeviceMetrics['memory']>

  return (
    typeof used === 'number' &&
    Number.isFinite(used) &&
    used >= 0 &&
    typeof total === 'number' &&
    Number.isFinite(total) &&
    total > 0
  )
}

// HMR may retain readings produced by an older route, so the shape is checked, not trusted.
function validMetrics(value: unknown): value is DeviceMetrics {
  if (!value || typeof value !== 'object') return false
  const sample = value as Partial<DeviceMetrics>

  return (
    typeof sample.sampledAt === 'string' &&
    Number.isFinite(Date.parse(sample.sampledAt)) &&
    typeof sample.cpuPercent === 'number' &&
    Number.isFinite(sample.cpuPercent) &&
    sample.cpuPercent >= 0 &&
    sample.cpuPercent <= 100 &&
    validCapacity(sample.memory) &&
    validCapacity(sample.disk)
  )
}

export type DeskGauge = {
  label: string
  /** 0–100, or null when there is no reading to show. */
  percent: number | null
  value: string
  /** "12.6 of 16 GB" for memory and disk. */
  detail: string | null
}

export type DeskReadings = {
  status: string
  tone: 'live' | 'stale' | 'idle'
  gauges: DeskGauge[]
}

const gauge = (label: string, percent: number | null, detail: string | null): DeskGauge => ({
  label,
  percent,
  value: percent === null ? '—' : `${String(Math.round(percent))}%`,
  detail,
})

const used = (value: { used: number; total: number }) =>
  `${gib(value.used)} of ${gib(value.total)} GB`

/** What a computer's screen shows: how fresh its reading is, then CPU, memory and disk. */
export function deskReadings(metrics: unknown, status?: MetricsStatus): DeskReadings {
  const reading = validMetrics(metrics) ? metrics : null
  const state = status ?? (reading ? 'live' : 'waiting')
  // Only a live or stale reading is shown; any other state has nothing current to say.
  const current = state === 'live' || state === 'stale' ? reading : null
  let tone: DeskReadings['tone'] = 'idle'

  if (current) tone = state === 'live' ? 'live' : 'stale'

  return {
    status: STATUS_LABEL[state === 'live' && !current ? 'waiting' : state],
    tone,
    gauges: [
      gauge('CPU', current ? current.cpuPercent : null, null),
      gauge('Memory', current && share(current.memory), current && used(current.memory)),
      gauge('Disk', current && share(current.disk), current && used(current.disk)),
    ],
  }
}
