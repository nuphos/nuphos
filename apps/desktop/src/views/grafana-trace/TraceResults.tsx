import { AlertCircle, ChevronRight, X } from 'lucide-react'

import { formatDurationMs, formatTimestamp } from './format'

import type { TraceNotice } from './notices'
import type { TempoTraceSummary } from '../../grafana/client'

export function TraceResults({
  traces,
  loading,
  selectedTraceId,
  onOpen,
}: {
  traces: TempoTraceSummary[]
  loading: boolean
  selectedTraceId: string | null
  onOpen: (traceId: string) => void
}) {
  return (
    <div className="border-r border-zGray-800/60 h-full min-h-0 overflow-auto scrollbar-thin">
      <div className="sticky top-0 z-10 bg-zGray-950 border-b border-zGray-800/60 px-4 py-2 text-[11.5px] text-tertiary uppercase tracking-wider">
        {loading ? 'Loading traces...' : `${String(traces.length)} traces`}
      </div>
      {traces.length === 0 && !loading ? (
        <div className="px-4 py-10 text-center text-[12.5px] text-tertiary">
          Run a TraceQL search or open a trace ID.
        </div>
      ) : (
        <div>
          {traces.map((trace) => (
            <button
              key={trace.traceId}
              onClick={() => onOpen(trace.traceId)}
              className={[
                'w-full text-left px-4 py-2.5 border-b border-zGray-800/40 hover:bg-zGray-900/60',
                selectedTraceId === trace.traceId ? 'bg-zViolet-500/10' : '',
              ].join(' ')}
            >
              <div className="flex items-center gap-2 min-w-0">
                <div className="text-[12.5px] text-main truncate flex-1">
                  {trace.rootTraceName || trace.traceId}
                </div>
                <ChevronRight
                  className="w-3.5 h-3.5 text-tertiary flex-shrink-0"
                  strokeWidth={1.8}
                />
              </div>
              <div className="mt-0.5 flex items-center gap-2 text-[11.5px] text-tertiary min-w-0">
                <span className="truncate">{trace.rootServiceName || 'unknown service'}</span>
                {trace.durationMs !== undefined && (
                  <span className="flex-shrink-0">{formatDurationMs(trace.durationMs)}</span>
                )}
              </div>
              {trace.startTimeUnixNano && (
                <div className="mt-0.5 text-[10.5px] text-tertiary truncate">
                  {formatTimestamp(Number(trace.startTimeUnixNano) / 1e6)}
                </div>
              )}
              <div className="mt-0.5 font-mono text-[10.5px] text-tertiary truncate">
                {trace.traceId}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export function TraceNoticeBanner({
  notice,
  onDismiss,
}: {
  notice: TraceNotice
  onDismiss: () => void
}) {
  return (
    <div className="px-4 py-2.5 bg-zGray-900/80 text-secondary text-[12.5px] border-b border-zGray-800/80">
      <div className="flex items-start gap-2">
        <AlertCircle
          className="w-4 h-4 mt-0.5 text-zOrangered-400 flex-shrink-0"
          strokeWidth={1.8}
        />
        <div className="min-w-0 flex-1">
          <div className="text-main">{notice.title}</div>
          {notice.detail && (
            <div className="mt-0.5 text-tertiary whitespace-pre-wrap break-words">
              {notice.detail}
            </div>
          )}
        </div>
        <button
          onClick={onDismiss}
          className="h-6 w-6 inline-flex items-center justify-center rounded-md text-tertiary hover:text-main hover:bg-zGray-800"
          title="Dismiss"
        >
          <X className="w-3.5 h-3.5" strokeWidth={1.8} />
        </button>
      </div>
    </div>
  )
}
