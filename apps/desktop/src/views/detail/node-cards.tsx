import clsx from 'clsx'
import { useState } from 'react'

import type { NodeDetail, NodeResourceMeter } from '../../types'

export function NodeUtilizationCard({
  title,
  meter,
  format,
}: {
  title: string
  meter: NodeResourceMeter
  format: (n: number | null) => string
}) {
  const usagePct =
    meter.usage != null && meter.capacity ? (meter.usage / meter.capacity) * 100 : null
  const reqPct =
    meter.requests != null && meter.allocatable ? (meter.requests / meter.allocatable) * 100 : null
  const limPct =
    meter.limits != null && meter.allocatable ? (meter.limits / meter.allocatable) * 100 : null
  const usageTone =
    usagePct == null
      ? ''
      : usagePct >= 90
        ? 'bg-error'
        : usagePct >= 75
          ? 'bg-warning'
          : 'bg-success'

  return (
    <div className="bg-zGray-900 border border-zGray-800 rounded-md px-4 py-3">
      <div className="text-[11.5px] uppercase tracking-wider text-tertiary mb-2">{title}</div>
      <div className="flex items-baseline justify-between text-[12px]">
        <span className="text-secondary">Usage</span>
        <span className="tabular-nums text-main">
          {format(meter.usage)} / {format(meter.capacity)}
        </span>
      </div>
      <div className="mt-1 flex items-center gap-2">
        <div className="flex-1 h-1.5 rounded-full bg-zGray-800 overflow-hidden">
          {usagePct != null && (
            <div
              className={clsx('h-full', usageTone)}
              style={{ width: `${String(Math.min(100, usagePct))}%` }}
            />
          )}
        </div>
        <span className="w-9 text-right text-[11px] text-tertiary tabular-nums">
          {usagePct != null ? `${String(Math.round(usagePct))}%` : '–'}
        </span>
      </div>
      <div className="mt-3 space-y-1.5">
        <div className="flex items-center justify-between text-[11.5px]">
          <span className="text-tertiary">Allocatable</span>
          <span className="tabular-nums text-secondary">{format(meter.allocatable)}</span>
        </div>
        <NodeSubMeter label="Requests" value={format(meter.requests)} pct={reqPct} />
        <NodeSubMeter label="Limits" value={format(meter.limits)} pct={limPct} />
      </div>
    </div>
  )
}

// Requests/Limits sub-bar, relative to the node's allocatable (the bar's 100%).
function NodeSubMeter({ label, value, pct }: { label: string; value: string; pct: number | null }) {
  return (
    <div className="flex items-center gap-2 text-[11.5px]">
      <span className="w-20 shrink-0 text-tertiary">{label}</span>
      <div className="flex-1 h-1 rounded-full bg-zGray-800 overflow-hidden">
        {pct != null && (
          <div
            className="h-full bg-zViolet-accent/70"
            style={{ width: `${String(Math.min(100, pct))}%` }}
          />
        )}
      </div>
      <span className="w-16 text-right tabular-nums text-secondary">{value}</span>
    </div>
  )
}

// Labels/Annotations as chips, collapsed past `limit` with a show-more toggle.
// `keyOnly` renders just the key (annotations can be huge values).
export function CollapsibleChips({
  entries,
  keyOnly = false,
  limit = 6,
}: {
  entries: [string, string][]
  keyOnly?: boolean
  limit?: number
}) {
  const [expanded, setExpanded] = useState(false)

  if (entries.length === 0) return <span className="text-tertiary">-</span>
  const shown = expanded ? entries : entries.slice(0, limit)

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {shown.map(([k, v]) => (
        <span
          key={k}
          className="max-w-full truncate bg-zGray-800 px-1.5 py-0.5 rounded text-[11.5px] text-secondary font-mono"
          title={keyOnly ? k : `${k}: ${v}`}
        >
          {keyOnly ? k : `${k}: ${v}`}
        </span>
      ))}
      {entries.length > limit && (
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          aria-expanded={expanded}
          aria-label={
            expanded ? 'Show fewer items' : `Show ${String(entries.length - limit)} more items`
          }
          className="text-[11px] text-zViolet-accent hover:opacity-80"
        >
          {expanded ? 'show less' : `show more (+${String(entries.length - limit)})`}
        </button>
      )}
    </div>
  )
}

export function ConditionChip({ c }: { c: NodeDetail['conditions'][number] }) {
  // Ready=True is healthy; any pressure/unavailable condition being True is bad,
  // as is Ready not being True.
  const bad = c.type === 'Ready' ? c.status !== 'True' : c.status === 'True'

  return (
    <span
      className={clsx(
        'bg-zGray-800 px-1.5 py-0.5 rounded text-[11.5px] font-mono',
        bad ? 'text-error' : 'text-success',
      )}
    >
      {c.type}={c.status}
    </span>
  )
}
