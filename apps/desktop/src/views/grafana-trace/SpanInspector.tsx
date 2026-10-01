import { Clipboard, X } from 'lucide-react'
import { useState } from 'react'

import { formatAttribute, formatDurationMs, formatTimestamp } from './format'

import type { TempoSpan } from '../../grafana/client'

export function SpanInspector({
  span,
  traceId,
  onClose,
}: {
  span: TempoSpan | null
  traceId: string
  onClose: () => void
}) {
  if (!span) {
    return (
      <div className="border-l border-zGray-800/60 h-full min-h-0 flex items-center justify-center text-[12.5px] text-tertiary">
        Select a span for details.
      </div>
    )
  }

  const entries = Object.entries(span.attributes).sort(([a], [b]) => a.localeCompare(b))

  return (
    <div className="border-l border-zGray-800/60 h-full min-h-0 flex flex-col">
      <div className="flex-shrink-0 bg-zGray-950 border-b border-zGray-800/60 px-4 py-3">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <div className="text-[13px] text-main font-medium truncate">{span.name}</div>
            <div className="mt-0.5 text-[11.5px] text-tertiary truncate">
              {span.serviceName || 'unknown service'}
            </div>
          </div>
          <button
            onClick={onClose}
            className="h-6 w-6 inline-flex items-center justify-center rounded-md text-tertiary hover:text-main hover:bg-zGray-800"
            title="Close span details"
          >
            <X className="w-3.5 h-3.5" strokeWidth={1.8} />
          </button>
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-auto scrollbar-thin p-4 space-y-5">
        <div className="grid grid-cols-2 gap-2">
          <Metric label="Duration" value={formatDurationMs(span.durationMs)} />
          <Metric label="Start" value={formatTimestamp(span.startTimeUnixNano / 1e6)} />
        </div>

        <div className="space-y-2">
          <InspectorHeader title="IDs" />
          <KeyValue label="Trace ID" value={traceId} copy />
          <KeyValue label="Span ID" value={span.spanId} copy />
          {span.parentSpanId && <KeyValue label="Parent" value={span.parentSpanId} copy />}
        </div>

        <div className="space-y-2">
          <InspectorHeader title={`Attributes (${String(entries.length)})`} />
          {entries.length === 0 ? (
            <div className="text-[12px] text-tertiary">No attributes returned.</div>
          ) : (
            entries.map(([key, value]) => (
              <KeyValue key={key} label={key} value={formatAttribute(value)} copy />
            ))
          )}
        </div>
      </div>
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-zGray-800/70 bg-zGray-900/50 px-3 py-2 min-w-0">
      <div className="text-[10.5px] uppercase tracking-wider text-tertiary">{label}</div>
      <div className="mt-0.5 text-[12.5px] text-main truncate">{value}</div>
    </div>
  )
}

function InspectorHeader({ title }: { title: string }) {
  return <div className="text-[10.5px] uppercase tracking-wider text-tertiary">{title}</div>
}

function KeyValue({ label, value, copy }: { label: string; value: string; copy?: boolean }) {
  return (
    <div className="group rounded-md border border-zGray-800/50 bg-zGray-900/30 px-3 py-2 min-w-0">
      <div className="flex items-center gap-2">
        <div className="text-[11px] text-tertiary truncate flex-1">{label}</div>
        {copy && <CopyButton value={value} title={`Copy ${label}`} />}
      </div>
      <div className="mt-1 text-[12px] text-main font-mono break-all selectable">{value}</div>
    </div>
  )
}

export function CopyButton({ value, title }: { value: string; title: string }) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 900)
    } catch {
      setCopied(false)
    }
  }

  return (
    <button
      onClick={(e) => {
        e.stopPropagation()
        void copy()
      }}
      className="h-6 px-1.5 inline-flex items-center gap-1 rounded-md text-tertiary hover:text-main hover:bg-zGray-800"
      title={title}
    >
      <Clipboard className="w-3.5 h-3.5" strokeWidth={1.8} />
      {copied && <span className="text-[10.5px]">Copied</span>}
    </button>
  )
}
