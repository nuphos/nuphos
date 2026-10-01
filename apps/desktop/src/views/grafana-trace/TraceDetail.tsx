import { ChevronRight, Clock, Server } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'

import { formatDurationMs } from './format'
import { ColumnResizeHandle, InlineColumnResizeHandle } from './resize-handles'
import { buildSpanTreeRows } from './span-tree'
import { CopyButton, SpanInspector } from './SpanInspector'

import type { SpanTreeRow } from './span-tree'
import type { TempoTrace } from '../../grafana/client'

export function TraceDetail({
  trace,
  selectedSpanId,
  onSelectSpan,
}: {
  trace: TempoTrace | null
  selectedSpanId: string | null
  onSelectSpan: (spanId: string | null) => void
}) {
  const [inspectorPanePct, setInspectorPanePct] = useState(32)
  const [spanColumnPct, setSpanColumnPct] = useState(38)
  const detailRef = useRef<HTMLDivElement | null>(null)
  const waterfallRef = useRef<HTMLDivElement | null>(null)
  const bounds = useMemo(() => {
    if (!trace || trace.spans.length === 0) return null
    let start = Infinity
    let end = -Infinity

    for (const span of trace.spans) {
      start = Math.min(start, span.startTimeUnixNano)
      end = Math.max(end, span.endTimeUnixNano)
    }

    return { start, end, span: Math.max(1, end - start) }
  }, [trace])

  const treeRows = useMemo(() => (trace ? buildSpanTreeRows(trace.spans) : []), [trace])
  const selectedSpan = useMemo(
    () => trace?.spans.find((span) => span.spanId === selectedSpanId) ?? null,
    [selectedSpanId, trace],
  )
  const services = useMemo(() => {
    if (!trace) return []
    const names = trace.spans
      .map((span) => span.serviceName)
      .filter((name): name is string => Boolean(name))

    return Array.from(new Set(names)).sort((a, b) => a.localeCompare(b))
  }, [trace])

  if (!trace) {
    return (
      <div className="h-full min-h-0 flex items-center justify-center px-6 text-[12.5px] text-tertiary">
        Select a trace to inspect spans.
      </div>
    )
  }

  if (!bounds || trace.spans.length === 0) {
    return (
      <div className="h-full min-h-0 flex items-center justify-center px-6 text-[12.5px] text-tertiary">
        No spans returned for this trace.
      </div>
    )
  }

  const root = treeRows[0]?.span ?? trace.spans[0]
  const spanGridTemplate = `${String(spanColumnPct)}% minmax(120px, 1fr) 78px`

  return (
    <div ref={detailRef} className="h-full min-h-0 flex overflow-hidden">
      <div
        ref={waterfallRef}
        className="h-full min-h-0 min-w-[360px] overflow-auto scrollbar-thin"
        style={{ width: `${String(100 - inspectorPanePct)}%` }}
      >
        <div className="sticky top-0 z-10 bg-zGray-950 border-b border-zGray-800/60">
          <div className="px-4 py-3 border-b border-zGray-800/50">
            <div className="flex items-center gap-2 min-w-0">
              <div className="text-[13px] text-main font-medium truncate flex-1">{root.name}</div>
              <CopyButton value={trace.traceId} title="Copy trace ID" />
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-tertiary">
              <span className="inline-flex items-center gap-1">
                <Clock className="w-3 h-3" strokeWidth={1.8} />
                {formatDurationMs(bounds.span / 1e6)}
              </span>
              <span>{trace.spans.length} spans</span>
              <span>{services.length} services</span>
              <span className="font-mono truncate max-w-[260px]">{trace.traceId}</span>
            </div>
          </div>
          <div
            className="relative grid gap-3 px-4 py-2 text-[10.5px] text-tertiary uppercase tracking-wider"
            style={{ gridTemplateColumns: spanGridTemplate }}
          >
            <div>Span</div>
            <div>Timeline</div>
            <div className="text-right">Duration</div>
            <InlineColumnResizeHandle
              containerRef={waterfallRef}
              valuePct={spanColumnPct}
              onChange={setSpanColumnPct}
              minPct={24}
              maxPct={62}
              label="Resize span column"
            />
          </div>
        </div>
        <div className="p-3 space-y-1">
          {treeRows.map((row) => (
            <SpanRow
              key={row.span.spanId}
              row={row}
              bounds={bounds}
              selected={row.span.spanId === selectedSpanId}
              gridTemplate={spanGridTemplate}
              onSelect={() => onSelectSpan(row.span.spanId)}
            />
          ))}
        </div>
      </div>
      <ColumnResizeHandle
        containerRef={detailRef}
        valuePct={100 - inspectorPanePct}
        onChange={(next) => setInspectorPanePct(100 - next)}
        minPct={52}
        maxPct={78}
        label="Resize span details column"
      />
      <div
        className="h-full min-h-0 min-w-[240px]"
        style={{ width: `${String(inspectorPanePct)}%` }}
      >
        <SpanInspector
          span={selectedSpan}
          traceId={trace.traceId}
          onClose={() => onSelectSpan(null)}
        />
      </div>
    </div>
  )
}

function SpanRow({
  row,
  bounds,
  selected,
  gridTemplate,
  onSelect,
}: {
  row: SpanTreeRow
  bounds: { start: number; end: number; span: number }
  selected: boolean
  gridTemplate: string
  onSelect: () => void
}) {
  const { span, depth, hasChildren } = row
  const left = ((span.startTimeUnixNano - bounds.start) / bounds.span) * 100
  const width = Math.max(0.6, ((span.endTimeUnixNano - span.startTimeUnixNano) / bounds.span) * 100)

  return (
    <button
      onClick={onSelect}
      style={{ gridTemplateColumns: gridTemplate }}
      className={[
        'w-full grid gap-3 items-center rounded-md px-2 py-1.5 text-left hover:bg-zGray-900/70',
        selected ? 'bg-zViolet-500/12 ring-1 ring-zViolet-500/30' : '',
      ].join(' ')}
    >
      <div className="min-w-0">
        <div className="flex items-center gap-1.5 min-w-0" style={{ paddingLeft: depth * 14 }}>
          <span className="w-3.5 flex-shrink-0 text-tertiary">
            {hasChildren ? <ChevronRight className="w-3 h-3" strokeWidth={1.8} /> : null}
          </span>
          <span className="text-[12.5px] text-main truncate">{span.name}</span>
        </div>
        <div
          className="mt-0.5 flex items-center gap-1.5 min-w-0 text-[11px] text-tertiary"
          style={{ paddingLeft: depth * 14 + 20 }}
        >
          <Server className="w-3 h-3 flex-shrink-0" strokeWidth={1.8} />
          <span className="truncate">{span.serviceName || 'unknown service'}</span>
        </div>
      </div>
      <div className="relative h-6 rounded bg-zGray-900 overflow-hidden">
        <div
          className="absolute top-1 bottom-1 rounded-sm bg-zViolet-accent/70"
          style={{ left: `${String(left)}%`, width: `${String(width)}%` }}
        />
      </div>
      <div className="text-right text-[11.5px] text-tertiary tabular-nums">
        {formatDurationMs(span.durationMs)}
      </div>
    </button>
  )
}
