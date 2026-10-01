import type { MongoMonitoringSample } from '../../types'

export type ChartRow = {
  timestamp: string
  query: number | null
  command: number | null
  writes: number | null
  readLatency: number | null
  writeLatency: number | null
  commandLatency: number | null
  bytesIn: number | null
  bytesOut: number | null
  connections: number | null
  connectionUsage: number | null
  cacheUsage: number | null
  dirtyCache: number | null
  residentMemory: number | null
  virtualMemory: number | null
  queue: number | null
  replicationLag: number | null
}

export const RANGE_OPTIONS = [
  { value: 60, label: 'Last hour' },
  { value: 360, label: 'Last 6 hours' },
  { value: 1_440, label: 'Last 24 hours' },
] as const

export const INTERVAL_OPTIONS = [15, 30, 60] as const

export const CHART_COLORS = ['#a469ff', '#43d9ad', '#f1b84b', '#5da9ff']

export function toChartRow(sample: MongoMonitoringSample): ChartRow {
  const metrics = sample.metrics

  return {
    timestamp: sample.sampledAt,
    query: sample.rates.queryPerSecond,
    command: sample.rates.commandPerSecond,
    writes: sumNullable([
      sample.rates.insertPerSecond,
      sample.rates.updatePerSecond,
      sample.rates.deletePerSecond,
    ]),
    readLatency: microsToMillis(sample.rates.readLatencyMicros),
    writeLatency: microsToMillis(sample.rates.writeLatencyMicros),
    commandLatency: microsToMillis(sample.rates.commandLatencyMicros),
    bytesIn: divide(sample.rates.bytesInPerSecond, 1_024),
    bytesOut: divide(sample.rates.bytesOutPerSecond, 1_024),
    connections: metrics.connectionsCurrent,
    connectionUsage: percent(
      metrics.connectionsCurrent,
      addNullable(metrics.connectionsCurrent, metrics.connectionsAvailable),
    ),
    cacheUsage: percent(metrics.wiredTigerCacheBytes, metrics.wiredTigerCacheMaxBytes),
    dirtyCache: percent(metrics.wiredTigerDirtyBytes, metrics.wiredTigerCacheMaxBytes),
    residentMemory: bytesToGiB(metrics.memoryResidentBytes),
    virtualMemory: bytesToGiB(metrics.memoryVirtualBytes),
    queue: sumNullable([metrics.queueReaders, metrics.queueWriters]),
    replicationLag: metrics.replicationLagSeconds,
  }
}

export function sumNullable(values: (number | null)[]): number | null {
  const available = values.filter((value): value is number => value !== null)

  return available.length ? available.reduce((total, value) => total + value, 0) : null
}

export function addNullable(left: number | null, right: number | null): number | null {
  return left === null || right === null ? null : left + right
}

export function percent(value: number | null, maximum: number | null): number | null {
  return value === null || maximum === null || maximum <= 0 ? null : (value / maximum) * 100
}

function divide(value: number | null, divisor: number): number | null {
  return value === null ? null : value / divisor
}

function bytesToGiB(value: number | null): number | null {
  return divide(value, 1_024 ** 3)
}

function microsToMillis(value: number | null): number | null {
  return divide(value, 1_000)
}

export function formatNumber(value: number | null | undefined): string {
  return value === null || value === undefined ? '—' : compact(value)
}

export function formatRate(value: number | null, suffix: string): string {
  return value === null ? '—' : `${value.toFixed(value >= 100 ? 0 : 1)}${suffix}`
}

export function formatPercent(value: number | null): string {
  return value === null ? '—' : `${value.toFixed(1)}%`
}

export function formatBytes(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let amount = value
  let index = 0

  while (amount >= 1_024 && index < units.length - 1) {
    amount /= 1_024
    index += 1
  }

  return `${amount.toFixed(amount >= 10 ? 1 : 2)} ${units[index]}`
}

export function formatDuration(value: number | null | undefined): string {
  return value === null || value === undefined
    ? '—'
    : value < 1
      ? `${String(Math.round(value * 1_000))} ms`
      : `${value.toFixed(value >= 10 ? 0 : 1)} s`
}

export function compact(value: number): string {
  return new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(
    value,
  )
}

export function formatTick(value: string): string {
  const date = new Date(value)

  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export function deploymentLabel(value: MongoMonitoringSample['deploymentType']): string {
  return value === 'replica-set'
    ? 'Replica set'
    : value === 'sharded'
      ? 'Sharded cluster'
      : value === 'standalone'
        ? 'Standalone'
        : 'Unknown'
}
