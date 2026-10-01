import {
  Activity,
  CirclePause,
  CirclePlay,
  Clock3,
  Gauge,
  MemoryStick,
  RefreshCw,
  Users,
} from 'lucide-react'

import { AppSelect } from '../../components/ui/select'

import {
  addNullable,
  formatBytes,
  formatDuration,
  formatNumber,
  formatPercent,
  formatRate,
  INTERVAL_OPTIONS,
  percent,
  RANGE_OPTIONS,
  sumNullable,
} from './monitoringFormat'

import type { MongoMonitoringSample } from '../../types'
import type { ReactElement } from 'react'

export function MonitoringSummaryHeader({
  latest,
  paused,
  sampling,
  error,
  rangeMinutes,
  intervalSeconds,
  onRangeChange,
  onIntervalChange,
  onTogglePause,
  onRefresh,
}: {
  latest: MongoMonitoringSample | null
  paused: boolean
  sampling: boolean
  error: string | null
  rangeMinutes: number
  intervalSeconds: number
  onRangeChange: (minutes: number) => void
  onIntervalChange: (seconds: number) => void
  onTogglePause: () => void
  onRefresh: () => void
}) {
  const isReplicaSet = latest?.deploymentType === 'replica-set'
  const opsPerSecond = latest
    ? sumNullable([
        latest.rates.queryPerSecond,
        latest.rates.insertPerSecond,
        latest.rates.updatePerSecond,
        latest.rates.deletePerSecond,
        latest.rates.commandPerSecond,
      ])
    : null
  const connectionUsage = latest
    ? percent(
        latest.metrics.connectionsCurrent,
        addNullable(latest.metrics.connectionsCurrent, latest.metrics.connectionsAvailable),
      )
    : null
  const cacheUsage = latest
    ? percent(latest.metrics.wiredTigerCacheBytes, latest.metrics.wiredTigerCacheMaxBytes)
    : null

  return (
    <section className="rounded-xl border border-zGray-800 bg-zGray-900/20">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-zGray-800 px-4 py-3.5">
        <div className="flex min-w-0 items-start gap-3">
          <div className="rounded-lg border border-zGray-700 bg-zGray-900 p-2 text-zViolet-accent">
            <Activity className="h-4 w-4" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-[14px] font-medium text-main">MongoDB performance</h2>
              <span
                className={`rounded-full border px-2 py-0.5 text-[9.5px] font-medium ${paused ? 'border-zGray-700 text-tertiary' : 'border-success/30 bg-success/5 text-success'}`}
              >
                {paused ? 'Paused' : 'Sampling while open'}
              </span>
            </div>
            <p className="mt-1 text-[10.5px] leading-4 text-tertiary">
              Numeric operational metrics only. Query text, result values, credentials, current
              operations, and profiler documents are not collected.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <AppSelect
            value={String(rangeMinutes)}
            onValueChange={(value) => onRangeChange(Number(value))}
            ariaLabel="Time range"
            triggerClassName="h-8 border-zGray-800 bg-field px-2.5 text-[12px]"
            options={RANGE_OPTIONS.map((option) => ({
              value: String(option.value),
              label: option.label,
            }))}
          />
          <AppSelect
            value={String(intervalSeconds)}
            onValueChange={(value) => onIntervalChange(Number(value))}
            disabled={paused}
            ariaLabel="Sampling interval"
            triggerClassName="h-8 border-zGray-800 bg-field px-2.5 text-[12px]"
            options={INTERVAL_OPTIONS.map((seconds) => ({
              value: String(seconds),
              label: `Every ${String(seconds)}s`,
            }))}
          />
          <button
            type="button"
            onClick={onTogglePause}
            className="flex items-center gap-1.5 rounded-md border border-zGray-700 px-2.5 py-1.5 text-[11px] text-secondary hover:text-main"
          >
            {paused ? (
              <CirclePlay className="h-3.5 w-3.5" />
            ) : (
              <CirclePause className="h-3.5 w-3.5" />
            )}
            {paused ? 'Resume' : 'Pause'}
          </button>
          <button
            type="button"
            aria-label="Collect a fresh sample"
            disabled={sampling}
            onClick={onRefresh}
            className="rounded-md border border-zGray-700 p-1.5 text-tertiary hover:text-main disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${sampling ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {error && (
        <div className="mx-4 mt-4 rounded-lg border border-error/40 bg-error/5 px-3 py-2.5 text-[11px] text-error">
          {error}
        </div>
      )}

      <div
        className={`grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3 ${isReplicaSet ? 'xl:grid-cols-5' : 'xl:grid-cols-4'}`}
      >
        <SummaryCard
          icon={<Users />}
          label="Connections"
          value={formatNumber(latest?.metrics.connectionsCurrent)}
          detail={
            connectionUsage === null
              ? 'available capacity unavailable'
              : `${formatPercent(connectionUsage)} of capacity`
          }
        />
        <SummaryCard
          icon={<Activity />}
          label="Operations"
          value={formatRate(opsPerSecond, '/s')}
          detail="query, command, and writes"
        />
        <SummaryCard
          icon={<Gauge />}
          label="WiredTiger cache"
          value={formatPercent(cacheUsage)}
          detail={formatBytes(latest?.metrics.wiredTigerCacheBytes)}
        />
        <SummaryCard
          icon={<MemoryStick />}
          label="Process memory"
          value={formatBytes(latest?.metrics.memoryResidentBytes)}
          detail={`resident · ${formatBytes(latest?.metrics.memoryVirtualBytes)} virtual`}
        />
        {isReplicaSet && (
          <SummaryCard
            icon={<Clock3 />}
            label="Replication lag"
            value={formatDuration(latest.metrics.replicationLagSeconds)}
            detail={latest.replicaSetName ?? 'replica set'}
          />
        )}
      </div>
    </section>
  )
}

function SummaryCard({
  icon,
  label,
  value,
  detail,
}: {
  icon: ReactElement
  label: string
  value: string
  detail: string
}) {
  return (
    <div className="rounded-xl border border-zGray-800 bg-zGray-950/35 p-3.5">
      <div className="flex items-center gap-2 text-[10.5px] text-tertiary">
        <span className="[&>svg]:h-3.5 [&>svg]:w-3.5">{icon}</span>
        {label}
      </div>
      <div className="mt-2 text-[21px] font-medium text-main">{value}</div>
      <div className="mt-1 truncate text-[9.5px] text-tertiary">{detail}</div>
    </div>
  )
}
