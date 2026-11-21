import { t } from '../../i18n/index.ts'

import type { DeviceMetrics, DeviceMetricsStatus } from '../../api/device-types'

/** `creating` while a Box is still being made, `connecting` while its machine waits for its host. */
export type MetricsStatus = DeviceMetricsStatus | 'creating' | 'connecting'

const STATUS_LABEL: Record<MetricsStatus, string> = {
  creating: t('Starting'),
  connecting: t('Waiting for the host'),
  offline: t('Host offline'),
  unsupported: t('No metrics on this host'),
  waiting: t('Waiting for metrics'),
  stale: t('Stale reading'),
  live: t('Live'),
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
  t('{used} of {total} GB', { used: gib(value.used), total: gib(value.total) })

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
      gauge(t('Memory'), current && share(current.memory), current && used(current.memory)),
      gauge(t('Disk'), current && share(current.disk), current && used(current.disk)),
    ],
  }
}

/** From here a disk is close enough to full that agents on it are about to fail. */
const DISK_WARNING_PERCENT = 90

/** What to say about a disk that is almost full. Only a live reading says anything. */
export function diskWarning(
  device: { metricsStatus?: DeviceMetricsStatus; metrics?: unknown } | undefined,
): { percent: number; text: string } | null {
  const disk =
    device?.metricsStatus === 'live' && validMetrics(device.metrics) ? device.metrics.disk : null

  if (!disk || share(disk) < DISK_WARNING_PERCENT) return null

  return {
    percent: Math.round(share(disk)),
    text: t('Disk almost full: {free} GB free', { free: gib(Math.max(0, disk.total - disk.used)) }),
  }
}

/** How long after an OOM kill the computer goes on saying so. */
const OOM_NOTICE_MS = 24 * 60 * 60 * 1000

/**
 * What to say after the kernel's OOM killer stopped a process, from the host's own reading. The
 * count rises for any OOM kill, machine-wide or under a cgroup limit, so it says only that memory
 * ran low: not where, not which process, and not that it dropped the connection. A disconnect
 * with no kill recorded says nothing about memory.
 */
export function memoryWarning(
  device: { metricsStatus?: DeviceMetricsStatus; metrics?: unknown } | undefined,
  now = Date.now(),
): { text: string; hint: string } | null {
  const current = device?.metricsStatus === 'live' || device?.metricsStatus === 'stale'
  const at = current && validMetrics(device.metrics) ? device.metrics.oomKilledAt : undefined
  const age = at === undefined ? Number.NaN : now - Date.parse(at)

  if (!(age >= 0 && age < OOM_NOTICE_MS)) return null

  return {
    text: t('In the last day, the system stopped a process because memory ran low'),
    hint: t(
      'A Bot or Task that was running then may have failed. Run fewer Bots, Tasks, builds or browsers at once, then resend what failed.',
    ),
  }
}
