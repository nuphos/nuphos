import clsx from 'clsx'

import { AppSelect } from '../../components/ui/select'
import { toneBgClass, toneTextClass } from '../../lib/workloadStatus'
import { formatCpu, formatMemory } from '../../utils'

import { PanelEmpty } from './overviewPanels'
import { ABNORMAL_THRESHOLDS } from './overviewTypes'

import type { OverviewCard, Segment } from './overviewTypes'
import type { AppSelectOption } from '../../components/ui/select'
import type { Tone } from '../../lib/workloadStatus'
import type { ContainerUsageRow } from '../../types'
import type { ReactNode } from 'react'

// "High / Abnormal Resource Usage": containers whose CPU or memory usage is at
// or above the selected % of their limit. The backend pre-sorts by the higher
// ratio and caps the payload, so filtering here can't hide a top offender.
export function AbnormalUsagePanel({
  loading,
  rows,
  threshold,
  onThresholdChange,
  onNavigate,
}: {
  loading: boolean
  rows: ContainerUsageRow[] | null
  threshold: number
  onThresholdChange: (value: number) => void
  onNavigate?: (navKey: string, filter?: string) => void
}) {
  const options: AppSelectOption[] = ABNORMAL_THRESHOLDS.map((t) => ({
    value: String(t),
    label: `≥ ${String(t)}% of Limit`,
  }))

  let body: ReactNode

  if (rows === null) {
    body = loading ? <PanelEmpty text="Loading…" /> : <PanelEmpty text="Unavailable" />
  } else {
    const filtered = rows.filter(
      (r) => (r.cpu_pct ?? 0) >= threshold || (r.memory_pct ?? 0) >= threshold,
    )

    if (filtered.length === 0) {
      body = <PanelEmpty text={`No containers above ${String(threshold)}% of limit.`} />
    } else {
      body = (
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2 px-1 text-[11px] uppercase tracking-wider text-tertiary">
            <span className="min-w-0 flex-1">Container</span>
            <span className="w-14 text-right">CPU</span>
            <span className="w-14 text-right">Memory</span>
          </div>
          {filtered.map((r) => (
            <button
              key={`${r.namespace}/${r.pod}/${r.container}`}
              type="button"
              disabled={!onNavigate}
              onClick={() => onNavigate?.('workloads.pods', `ns=${r.namespace} ${r.pod}`)}
              className={clsx(
                'flex items-center gap-2 text-left rounded px-1 py-0.5',
                onNavigate && 'hover:bg-zGray-850',
              )}
              title={onNavigate ? `Show pod ${r.namespace}/${r.pod}` : undefined}
            >
              <span className="min-w-0 flex-1">
                <span className="text-[12px] text-zViolet-accent truncate">{r.pod}</span>
                <span className="text-[11px] text-tertiary"> · {r.container}</span>
                <span className="block text-[11px] text-tertiary truncate">{r.namespace}</span>
              </span>
              <UsagePctCell
                pct={r.cpu_pct}
                usage={r.cpu_usage}
                limit={r.cpu_limit}
                format={formatCpu}
              />
              <UsagePctCell
                pct={r.memory_pct}
                usage={r.memory_usage}
                limit={r.memory_limit}
                format={formatMemory}
              />
            </button>
          ))}
        </div>
      )
    }
  }

  return (
    <div className="mt-3 bg-zGray-900 border border-zGray-800 rounded-md px-4 py-3">
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="text-[11.5px] uppercase tracking-wider text-tertiary">
          High / Abnormal Resource Usage
        </div>
        <AppSelect
          value={String(threshold)}
          onValueChange={(v) => onThresholdChange(Number(v))}
          options={options}
          ariaLabel="Usage threshold"
          className="w-40"
          triggerClassName="h-7"
        />
      </div>
      {body}
    </div>
  )
}

function UsagePctCell({
  pct,
  usage,
  limit,
  format,
}: {
  pct: number | null
  usage: number | null
  limit: number | null
  format: (n: number) => string
}) {
  if (pct == null) {
    return (
      <span className="w-14 shrink-0 text-right text-[12px] text-tertiary tabular-nums">–</span>
    )
  }
  const tone: Tone = pct >= 100 ? 'error' : pct >= 90 ? 'warning' : 'success'

  return (
    <span
      className={clsx('w-14 shrink-0 text-right text-[12px] tabular-nums', toneTextClass(tone))}
      title={usage != null && limit != null ? `${format(usage)} / ${format(limit)}` : undefined}
    >
      {Math.round(pct)}%
    </span>
  )
}

export function SkeletonCard() {
  return (
    <div className="bg-zGray-900 border border-zGray-800 rounded-md px-4 py-3 h-[92px]">
      <div className="text-[11.5px] uppercase tracking-wider text-tertiary">—</div>
      <div className="text-[24px] font-semibold mt-1 text-main">…</div>
    </div>
  )
}

export function OverviewCardView({
  card,
  onNavigate,
}: {
  card: OverviewCard
  onNavigate?: (navKey: string, filter?: string) => void
}) {
  const navigable = !!card.navKey && card.total !== null

  return (
    <div className="bg-zGray-900 border border-zGray-800 rounded-md px-4 py-3 flex flex-col gap-2">
      <button
        type="button"
        disabled={!navigable}
        onClick={() => card.navKey && onNavigate?.(card.navKey)}
        className={clsx(
          'text-[11.5px] uppercase tracking-wider text-tertiary text-left self-start',
          navigable && 'hover:text-secondary',
        )}
      >
        {card.title}
      </button>

      {card.total === null ? (
        <div className="text-[13px] text-tertiary mt-1">Unavailable</div>
      ) : card.segments.length === 0 ? (
        <div className="text-[24px] font-semibold text-main leading-none">{card.total}</div>
      ) : (
        <>
          <StatusBar segments={card.segments} total={card.total} />
          <div className="flex flex-col gap-0.5">
            {card.segments.map((seg) => {
              const clickable = !!card.navKey && !!seg.filter

              return (
                <button
                  key={seg.label}
                  type="button"
                  disabled={!clickable}
                  onClick={() => card.navKey && seg.filter && onNavigate?.(card.navKey, seg.filter)}
                  className={clsx(
                    'flex items-baseline gap-1.5 text-left',
                    clickable && 'hover:opacity-80',
                  )}
                  title={clickable ? `Show ${seg.label} ${card.title.toLowerCase()}` : undefined}
                >
                  <span
                    className={clsx(
                      'text-[15px] font-semibold tabular-nums',
                      toneTextClass(seg.tone),
                    )}
                  >
                    {seg.count}
                  </span>
                  <span className="text-[12px] text-secondary">{seg.label}</span>
                </button>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}

// A thin proportional bar summarising the phase breakdown, à la Aptakube.
function StatusBar({ segments, total }: { segments: Segment[]; total: number }) {
  if (total <= 0) {
    return <div className="h-1.5 rounded-full bg-zGray-800" />
  }

  return (
    <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-zGray-800">
      {segments.map((seg) => (
        <div
          key={seg.label}
          className={toneBgClass(seg.tone)}
          style={{ width: `${String((seg.count / total) * 100)}%` }}
        />
      ))}
    </div>
  )
}
