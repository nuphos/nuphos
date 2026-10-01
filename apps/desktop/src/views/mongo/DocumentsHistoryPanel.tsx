import { Clock3, Loader2, RefreshCw, X } from 'lucide-react'

import type { DatabaseQueryAudit } from '../../types'

export function DocumentsHistoryPanel({
  database,
  collection,
  history,
  historyError,
  onRefresh,
  onClose,
  onLoadEntry,
}: {
  database: string
  collection: string
  history: DatabaseQueryAudit[] | null
  historyError: string | null
  onRefresh: () => void
  onClose: () => void
  onLoadEntry: (event: DatabaseQueryAudit) => void
}) {
  return (
    <div className="absolute inset-y-0 right-0 z-30 flex w-[430px] flex-col border-l border-zGray-700 bg-zGray-950 shadow-2xl">
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-zGray-800 px-3">
        <div>
          <div className="text-[12px] font-medium text-main">Query history</div>
          <div className="text-[9.5px] text-tertiary">
            {database}.{collection}
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onRefresh}
            className="rounded p-1.5 text-tertiary hover:bg-zGray-800 hover:text-main"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1.5 text-tertiary hover:bg-zGray-800 hover:text-main"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {historyError && (
          <div className="rounded border border-error/30 bg-error/5 px-3 py-2 text-[10.5px] text-error">
            {historyError}
          </div>
        )}
        {history === null ? (
          <div className="flex h-32 items-center justify-center">
            <Loader2 className="h-4 w-4 animate-spin text-tertiary" />
          </div>
        ) : history.length === 0 ? (
          <div className="flex h-32 items-center justify-center text-[10.5px] text-tertiary">
            No query history for this collection.
          </div>
        ) : (
          <div className="space-y-2">
            {history.map((event) => (
              <div
                key={event.id}
                className="rounded-lg border border-zGray-800 bg-zGray-900/60 p-2.5"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <Clock3 className="h-3 w-3 text-tertiary" />
                      <span className="font-mono text-[10.5px] text-main">{event.operation}</span>
                      <span
                        className={`text-[9.5px] ${event.outcome === 'succeeded' ? 'text-success' : 'text-error'}`}
                      >
                        {event.outcome}
                      </span>
                    </div>
                    <div className="mt-1 text-[9.5px] text-tertiary">
                      {new Date(event.createdAt).toLocaleString()} · {event.rowCount ?? '—'} rows ·{' '}
                      {event.durationMs ?? '—'} ms
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={!event.queryInput}
                    onClick={() => onLoadEntry(event)}
                    className="rounded border border-zGray-700 px-2 py-1 text-[9.5px] text-secondary hover:border-zGray-600 hover:text-main disabled:opacity-35"
                  >
                    Load
                  </button>
                </div>
                <pre className="mt-2 max-h-28 overflow-hidden whitespace-pre-wrap break-words rounded bg-zGray-950/80 px-2 py-1.5 font-mono text-[9.5px] leading-4 text-tertiary">
                  {event.queryStatement ??
                    `Legacy record · fields: ${event.queryShape.join(', ') || 'none'}`}
                </pre>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
