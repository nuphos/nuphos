import clsx from 'clsx'

import { toneBgClass } from '../../lib/workloadStatus'
import { formatAge, formatCpu, formatMemory } from '../../utils'

import type { Meter, ResourceSummary, RestartItem, WarningItem } from './overviewTypes'
import type { Tone } from '../../lib/workloadStatus'
import type { ReactNode } from 'react'

function RecentPanel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="bg-zGray-900 border border-zGray-800 rounded-md px-4 py-3 min-h-[120px]">
      <div className="text-[11.5px] uppercase tracking-wider text-tertiary mb-3">{title}</div>
      {children}
    </div>
  )
}

export function PanelEmpty({ text }: { text: string }) {
  return <div className="text-[12px] text-tertiary py-4 text-center">{text}</div>
}

export function RecentWarningsPanel({
  loading,
  warnings,
}: {
  loading: boolean
  warnings: WarningItem[] | null
}) {
  let body: ReactNode

  if (warnings === null) {
    body = loading ? <PanelEmpty text="Loading…" /> : <PanelEmpty text="Unavailable" />
  } else if (warnings.length === 0) {
    body = <PanelEmpty text="No warning events in the last hour." />
  } else {
    body = (
      <div className="flex flex-col gap-2">
        {warnings.map((w) => (
          <div key={w.key} className="flex flex-col gap-0.5">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-[12px] text-warning font-medium">{w.reason}</span>
              <span className="text-[11px] text-tertiary shrink-0">{formatAge(w.iso)}</span>
            </div>
            <div className="text-[11.5px] text-secondary truncate" title={w.object}>
              {w.object}
            </div>
            <div className="text-[11.5px] text-tertiary line-clamp-2" title={w.message}>
              {w.message}
            </div>
          </div>
        ))}
      </div>
    )
  }

  return <RecentPanel title="Recent Warnings">{body}</RecentPanel>
}

export function RecentRestartsPanel({
  loading,
  restarts,
  onNavigate,
}: {
  loading: boolean
  restarts: RestartItem[] | null
  onNavigate?: (navKey: string, filter?: string) => void
}) {
  let body: ReactNode

  if (restarts === null) {
    body = loading ? <PanelEmpty text="Loading…" /> : <PanelEmpty text="Unavailable" />
  } else if (restarts.length === 0) {
    body = <PanelEmpty text="No containers have restarted in the last hour." />
  } else {
    body = (
      <div className="flex flex-col gap-2">
        {restarts.map((r) => (
          <button
            key={r.key}
            type="button"
            disabled={!onNavigate}
            onClick={() => onNavigate?.('workloads.pods', `ns=${r.namespace} ${r.name}`)}
            className={clsx(
              'flex items-baseline justify-between gap-2 text-left',
              onNavigate && 'hover:opacity-80',
            )}
            title={onNavigate ? `Show pod ${r.namespace}/${r.name}` : undefined}
          >
            <span className="min-w-0">
              <span className="text-[12px] text-zViolet-accent truncate">{r.name}</span>
              <span className="text-[11px] text-tertiary"> · {r.namespace}</span>
            </span>
            <span
              className="shrink-0 text-[11px] text-tertiary tabular-nums"
              title={`${String(r.restarts)} restarts total; latest ${formatAge(r.iso)} ago`}
            >
              <span className="text-warning">{r.restarts}×</span> total · {formatAge(r.iso)}
            </span>
          </button>
        ))}
      </div>
    )
  }

  return <RecentPanel title="Recent Restarts">{body}</RecentPanel>
}

export function SkeletonResourcePanel() {
  return (
    <div className="mt-3 bg-zGray-900 border border-zGray-800 rounded-md px-4 py-3">
      <div className="text-[11.5px] uppercase tracking-wider text-tertiary mb-3">
        Resource Usage
      </div>
      <div className="grid grid-cols-1 @3xl:grid-cols-2 gap-x-10 gap-y-4">
        {[0, 1].map((col) => (
          <div key={col}>
            <div className="h-3 w-32 rounded bg-zGray-800 mb-3" />
            <div className="flex flex-col gap-2">
              {[0, 1, 2].map((row) => (
                <div key={row} className="h-1.5 rounded-full bg-zGray-800" />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export function ResourceUsagePanel({ resources }: { resources: ResourceSummary }) {
  return (
    <div className="mt-3 bg-zGray-900 border border-zGray-800 rounded-md px-4 py-3">
      <div className="text-[11.5px] uppercase tracking-wider text-tertiary mb-3">
        Resource Usage
      </div>
      <div className="grid grid-cols-1 @3xl:grid-cols-2 gap-x-10 gap-y-4">
        <div>
          <div className="text-[12px] text-secondary mb-2">Usage / Allocatable</div>
          <div className="flex flex-col gap-2">
            <MeterRow label="CPU" meter={resources.cpuUsage} format={formatCpu} />
            <MeterRow label="Memory" meter={resources.memUsage} format={formatMemory} />
          </div>
        </div>
        <div>
          <div className="text-[12px] text-secondary mb-2">Requests / Allocatable</div>
          <div className="flex flex-col gap-2">
            <MeterRow label="CPU" meter={resources.cpuRequest} format={formatCpu} />
            <MeterRow label="Memory" meter={resources.memRequest} format={formatMemory} />
            <MeterRow label="Pods" meter={resources.pods} format={(n) => String(n)} />
          </div>
        </div>
      </div>
    </div>
  )
}

function MeterRow({
  label,
  meter,
  format,
}: {
  label: string
  meter: Meter
  format: (n: number) => string
}) {
  const { used, total } = meter
  const pct = used != null && total != null && total > 0 ? (used / total) * 100 : null
  const tone: Tone =
    pct == null ? 'neutral' : pct >= 90 ? 'error' : pct >= 75 ? 'warning' : 'success'

  return (
    <div className="flex items-center gap-3 text-[12px]">
      <span className="w-14 shrink-0 text-tertiary">{label}</span>
      <span className="w-9 shrink-0 text-right tabular-nums text-secondary">
        {pct != null ? `${String(Math.round(pct))}%` : '–'}
      </span>
      <div className="flex-1 h-1.5 rounded-full bg-zGray-800 overflow-hidden">
        {pct != null && (
          <div
            className={clsx('h-full', toneBgClass(tone))}
            style={{ width: `${String(Math.min(100, pct))}%` }}
          />
        )}
      </div>
      <span className="w-28 shrink-0 text-right tabular-nums text-secondary">
        {used != null ? format(used) : '–'} / {total != null ? format(total) : '–'}
      </span>
    </div>
  )
}
