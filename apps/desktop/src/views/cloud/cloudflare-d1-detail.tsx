import { faPlay } from '@fortawesome/free-solid-svg-icons'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { useCallback, useEffect, useState } from 'react'

import { api } from '../../api'
import { Table } from '../../components/Table'
import { useReportLoading } from '../../components/useReportLoading'

import type { CloudflareD1QueryResult } from '../../types'

// SQLite identifiers are double-quoted; embedded quotes are doubled. Quoting
// keeps generated queries valid for names with spaces/keywords and stops a
// crafted table name from injecting extra statements.
function quoteD1Identifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`
}

export function CloudflareD1DatabaseDetailView({
  teamId,
  accountId,
  databaseId,
  onLoading,
}: {
  teamId: string
  accountId: string
  databaseId: string
  onLoading?: (loading: boolean) => void
}) {
  const [tables, setTables] = useState<string[]>([])
  const [sql, setSql] = useState("SELECT name FROM sqlite_master WHERE type = 'table';")
  const [result, setResult] = useState<CloudflareD1QueryResult | null>(null)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useReportLoading(running, onLoading)

  const reloadTables = useCallback(() => {
    api
      .atlasListCloudflareD1Tables(teamId, accountId, databaseId)
      .then(setTables)
      .catch(() => setTables([]))
  }, [teamId, accountId, databaseId])

  useEffect(() => reloadTables(), [reloadTables])

  async function runQuery() {
    setRunning(true)
    setError(null)
    try {
      const res = await api.atlasQueryCloudflareD1(teamId, accountId, databaseId, sql)

      setResult(res)
      reloadTables()
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e))
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="shrink-0 border-b border-zGray-850 px-3 py-2">
        <div className="text-[12px] text-tertiary">Cloudflare D1 · provider managed</div>
      </div>
      <div className="flex-1 flex min-h-0">
        <div className="w-48 shrink-0 border-r border-zGray-850 overflow-auto p-3">
          <div className="text-[11px] font-medium text-tertiary mb-2 uppercase tracking-wide">
            Tables
          </div>
          {tables.length === 0 ? (
            <div className="text-[12px] text-tertiary">No tables</div>
          ) : (
            <div className="space-y-0.5">
              {tables.map((t) => (
                <button
                  key={t}
                  onClick={() => setSql(`SELECT * FROM ${quoteD1Identifier(t)} LIMIT 100;`)}
                  className="block w-full text-left px-2 py-1 rounded text-[12px] font-mono text-secondary hover:bg-zGray-850 hover:text-main truncate"
                  title={t}
                >
                  {t}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="flex-1 flex flex-col min-h-0">
          <div className="p-3 border-b border-zGray-850">
            <textarea
              value={sql}
              onChange={(e) => setSql(e.target.value)}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                  e.preventDefault()
                  void runQuery()
                }
              }}
              rows={4}
              spellCheck={false}
              className="w-full px-2.5 py-2 rounded-md bg-field border border-zGray-800 text-main outline-none focus:border-zViolet-accent font-mono text-[12.5px] resize-y"
            />
            <div className="flex items-center gap-2 mt-2">
              <button
                onClick={() => void runQuery()}
                disabled={running}
                className="h-7 px-3 rounded-md bg-zViolet-500 hover:bg-zViolet-400 text-white text-[12.5px] flex items-center gap-1.5 disabled:opacity-50"
              >
                <FontAwesomeIcon icon={faPlay} className="w-3.5 h-3.5" />{' '}
                {running ? 'Running…' : 'Run'}
              </button>
              <span className="text-[11px] text-tertiary">⌘/Ctrl + Enter</span>
              {result?.meta && (
                <span className="ml-auto text-[11px] text-tertiary">
                  {result.meta.rowsRead != null && `${String(result.meta.rowsRead)} read`}
                  {result.meta.rowsWritten ? ` · ${String(result.meta.rowsWritten)} written` : ''}
                  {result.meta.durationMs != null
                    ? ` · ${result.meta.durationMs.toFixed(1)}ms`
                    : ''}
                </span>
              )}
            </div>
          </div>
          <div className="flex-1 overflow-auto">
            {error ? (
              <div className="p-4 text-error text-[12.5px] font-mono whitespace-pre-wrap">
                {error}
              </div>
            ) : !result ? (
              <div className="p-4 text-tertiary text-[12.5px]">Run a query to see results.</div>
            ) : result.columns.length === 0 ? (
              <div className="p-4 text-secondary text-[12.5px]">
                Query OK
                {result.meta?.changes != null
                  ? ` · ${String(result.meta.changes)} row(s) affected`
                  : ''}
                .
              </div>
            ) : (
              <Table<D1ResultRow>
                rows={result.results.map((r, i) => ({ _i: i, row: r }))}
                rowKey={(r) => String(r._i)}
                storageKey="cloudflare.d1.results"
                empty="No rows"
                columns={result.columns.map((col) => ({
                  key: col,
                  header: col,
                  width: 180,
                  render: (r: D1ResultRow) => {
                    const v = r.row[col]

                    return (
                      <span
                        className="font-mono text-[12px] text-secondary truncate block max-w-[200px]"
                        title={v == null ? '' : formatD1Cell(v)}
                      >
                        {v == null ? <span className="text-tertiary">NULL</span> : formatD1Cell(v)}
                      </span>
                    )
                  },
                }))}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

type D1ResultRow = { _i: number; row: Record<string, unknown> }

// D1 hands back JSON scalars, but the column type is `unknown`; anything that
// is not a scalar is shown as JSON rather than `[object Object]`.
function formatD1Cell(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  try {
    return JSON.stringify(value) ?? ''
  } catch {
    return Object.prototype.toString.call(value)
  }
}
