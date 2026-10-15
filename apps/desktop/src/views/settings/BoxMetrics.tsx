import { useState } from 'react'

import './BoxMetrics.css'

import type { DeviceMetrics, DeviceMetricsStatus } from '../../api/device-types'

const SLOTS = 10
const gib = (bytes: number) => (bytes / 1024 ** 3).toFixed(1).replace(/\.0$/u, '')
const capacity = (value: { used: number; total: number }) =>
  `${gib(value.used)} / ${gib(value.total)}G`

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

// HMR may retain readings produced by an older route; validate both props and history.
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

const STATUS_LABEL: Record<DeviceMetricsStatus, string> = {
  offline: 'Host offline',
  unsupported: 'Host update required for metrics',
  waiting: 'Waiting for metrics',
  stale: 'Stale reading',
  live: 'Live',
}

/** Ten real samples, newest at the right. Empty slots never pretend to be history. */
export function BoxMetrics({
  metrics,
  paused,
  status,
  receivedAt,
}: {
  metrics?: DeviceMetrics | null
  paused: boolean
  status?: DeviceMetricsStatus
  receivedAt?: string | null
}) {
  const [history, setHistory] = useState<DeviceMetrics[]>([])
  const reading = validMetrics(metrics) ? metrics : null
  const state = status ?? (reading ? 'live' : 'waiting')
  const current = !paused && (state === 'live' || state === 'stale') ? reading : null
  const cleanHistory = Array.isArray(history) ? history.filter(validMetrics) : []
  const append = current && state === 'live' && cleanHistory.at(-1)?.sampledAt !== current.sampledAt

  if (append || !Array.isArray(history) || cleanHistory.length !== history.length) {
    setHistory(append ? [...cleanHistory, current].slice(-SLOTS) : cleanHistory)
  }
  const rows = [
    {
      label: 'CPU',
      value: current ? `${String(Math.round(current.cpuPercent))}%` : '—',
      percent: (m: DeviceMetrics) => m.cpuPercent,
    },
    {
      label: 'Memory',
      value: current ? capacity(current.memory) : '—',
      percent: (m: DeviceMetrics) => (m.memory.used / m.memory.total) * 100,
    },
    {
      label: 'Disk',
      value: current ? capacity(current.disk) : '—',
      percent: (m: DeviceMetrics) => (m.disk.used / m.disk.total) * 100,
    },
  ]
  const samples = current ? cleanHistory : []
  let statusLabel = STATUS_LABEL[state]

  if (state === 'live' && !current) statusLabel = STATUS_LABEL.waiting
  if (paused) statusLabel = 'Box paused'
  const received =
    receivedAt && Number.isFinite(Date.parse(receivedAt))
      ? `Received ${new Date(receivedAt).toLocaleTimeString()}`
      : null
  const title = [
    statusLabel,
    current && `Sampled ${new Date(current.sampledAt).toLocaleTimeString()}`,
    received,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <div className="mt-2 grid shrink-0 grid-cols-3 gap-x-3 gap-y-1" aria-label="Resource usage">
      <div
        role="status"
        className={`col-span-3 flex items-center justify-between gap-2 text-[10px] leading-[14px] ${state === 'stale' ? 'text-amber-500' : 'text-tertiary'}`}
        title={title}
      >
        <span>{statusLabel}</span>
        {received && receivedAt && (
          <time className="shrink-0" dateTime={receivedAt} aria-label={received}>
            {new Date(receivedAt).toLocaleTimeString()}
          </time>
        )}
      </div>
      {rows.map(({ label, value, percent }) => (
        <div key={label} className="min-w-0" title={`${label} · ${title}`}>
          <div className="text-[10px] leading-[14px] text-tertiary">{label}</div>
          <div className="mt-1 whitespace-nowrap text-[11px] leading-4 font-medium tabular-nums text-secondary">
            {value}
          </div>
          <div className="mt-1 flex h-6 items-end gap-[2px]" aria-hidden="true">
            {Array.from({ length: SLOTS }, (_, index) => {
              const sample: DeviceMetrics | undefined = samples.at(index - SLOTS)

              return (
                <span
                  key={index}
                  className={`t-resize min-w-0 flex-1 rounded-[1px] ${sample ? 'bg-zViolet-400' : 'bg-zGray-800/40'}`}
                  style={{
                    height: sample
                      ? `${String(Math.max(2, Math.min(100, percent(sample))))}%`
                      : '7.14%',
                  }}
                />
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}
