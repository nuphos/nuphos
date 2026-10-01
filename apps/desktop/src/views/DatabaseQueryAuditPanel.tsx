import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Loader2,
  RefreshCw,
  ShieldAlert,
} from 'lucide-react'
import { Fragment, useCallback, useEffect, useState } from 'react'

import { api, parseAtlasError } from '../api'

import { useResetOnKey } from './useResetOnKey'

import type { DatabaseQueryAudit } from '../types'

export function DatabaseQueryAuditPanel({
  teamId,
  connectionId,
}: {
  teamId: string
  connectionId: string
}) {
  const [events, setEvents] = useState<DatabaseQueryAudit[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const load = useCallback(() => {
    api
      .atlasListDatabaseQueryAudit(teamId, connectionId)
      .then(setEvents)
      .catch((cause: unknown) => {
        setError(parseAtlasError(cause).message)
        setEvents([])
      })
  }, [teamId, connectionId])

  // `load` is kicked from the effect below, so the pre-fetch reset it used to
  // do lives here instead; the refresh button does it inline.
  useResetOnKey(`${teamId}|${connectionId}`, () => setError(null))

  useEffect(() => {
    load()
  }, [load])

  return (
    <div className="overflow-hidden rounded-xl border border-zGray-800">
      <div className="flex items-center justify-between border-b border-zGray-800 px-4 py-3">
        <div>
          <div className="text-[13px] font-medium text-main">Query audit</div>
          <div className="mt-0.5 text-[10.5px] text-tertiary">
            Sanitized statements are retained for audit. Sensitive query values, results, and
            credentials are never stored.
          </div>
        </div>
        <button
          onClick={() => {
            setError(null)
            load()
          }}
          className="rounded p-1.5 text-tertiary hover:bg-zGray-800 hover:text-main"
        >
          <RefreshCw className="h-3.5 w-3.5" />
        </button>
      </div>
      {error && (
        <div className="m-3 rounded border border-error/30 bg-error/5 px-3 py-2 text-[11px] text-error">
          {error}
        </div>
      )}
      {events === null ? (
        <div className="flex h-48 items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-tertiary" />
        </div>
      ) : events.length === 0 ? (
        <div className="flex h-48 items-center justify-center text-[11.5px] text-tertiary">
          No database queries have been executed yet.
        </div>
      ) : (
        <div className="overflow-auto">
          <table className="w-full text-left text-[11px]">
            <thead className="bg-zGray-900 text-tertiary">
              <tr>
                <th className="px-3 py-2 font-medium">Time</th>
                <th className="px-3 py-2 font-medium">Operation</th>
                <th className="px-3 py-2 font-medium">Scope</th>
                <th className="px-3 py-2 font-medium">Statement</th>
                <th className="px-3 py-2 font-medium">Actor</th>
                <th className="px-3 py-2 font-medium">Outcome</th>
                <th className="px-3 py-2 font-medium">Rows</th>
                <th className="px-3 py-2 font-medium">Duration</th>
              </tr>
            </thead>
            <tbody>
              {events.map((event) => {
                const expanded = expandedId === event.id

                return (
                  <Fragment key={event.id}>
                    <tr className="border-t border-zGray-800/70 text-secondary">
                      <td className="whitespace-nowrap px-3 py-2 text-tertiary">
                        {new Date(event.createdAt).toLocaleString()}
                      </td>
                      <td className="px-3 py-2">
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 font-mono hover:text-main disabled:cursor-default disabled:hover:text-secondary"
                          disabled={!event.queryStatement}
                          onClick={() => setExpandedId(expanded ? null : event.id)}
                        >
                          {event.queryStatement ? (
                            expanded ? (
                              <ChevronDown className="h-3 w-3" />
                            ) : (
                              <ChevronRight className="h-3 w-3" />
                            )
                          ) : (
                            <span className="w-3" />
                          )}
                          {event.operation}
                        </button>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 font-mono">
                        {event.database}.{event.collection}
                      </td>
                      <td className="max-w-72 px-3 py-2">
                        <button
                          type="button"
                          disabled={!event.queryStatement}
                          onClick={() => setExpandedId(expanded ? null : event.id)}
                          className="block max-w-72 truncate font-mono text-left text-tertiary hover:text-main disabled:cursor-default disabled:hover:text-tertiary"
                          title={event.queryStatement ?? 'Legacy audit event'}
                        >
                          {event.queryStatement?.split('\n')[0] ??
                            `Legacy record · fields: ${event.queryShape.join(', ') || 'none'}`}
                        </button>
                      </td>
                      <td className="max-w-36 truncate px-3 py-2" title={event.userId}>
                        {event.source} · {event.userId}
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className={`inline-flex items-center gap-1 ${event.outcome === 'succeeded' ? 'text-success' : event.outcome === 'running' ? 'text-warning' : 'text-error'}`}
                        >
                          {event.outcome === 'succeeded' ? (
                            <CheckCircle2 className="h-3 w-3" />
                          ) : (
                            <ShieldAlert className="h-3 w-3" />
                          )}
                          {event.outcome}
                        </span>
                      </td>
                      <td className="px-3 py-2 tabular-nums">
                        {event.rowCount ?? '—'}
                        {event.truncated ? '+' : ''}
                      </td>
                      <td className="px-3 py-2 tabular-nums">
                        {event.durationMs === null ? '—' : `${String(event.durationMs)} ms`}
                      </td>
                    </tr>
                    {expanded && event.queryStatement && (
                      <tr className="border-t border-zGray-800/50 bg-zGray-950/40">
                        <td colSpan={8} className="px-3 py-3">
                          <div className="mb-2 flex items-center gap-2 text-[10px] text-tertiary">
                            Sanitized statement
                            {event.queryRedactedFields.length > 0 && (
                              <span className="rounded bg-warning/10 px-1.5 py-0.5 text-warning">
                                {event.queryRedactedFields.length} protected value(s)
                              </span>
                            )}
                            {event.queryStatementTruncated && (
                              <span className="rounded bg-warning/10 px-1.5 py-0.5 text-warning">
                                truncated
                              </span>
                            )}
                          </div>
                          <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-md border border-zGray-800 bg-zGray-950 px-3 py-2 font-mono text-[11px] leading-5 text-secondary">
                            {event.queryStatement}
                          </pre>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
