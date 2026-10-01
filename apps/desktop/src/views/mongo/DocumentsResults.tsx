import {
  Braces,
  ChevronLeft,
  ChevronRight,
  Download,
  History,
  List,
  Loader2,
  ShieldCheck,
} from 'lucide-react'

import { displayValue, OPERATIONS } from './documentsQuery'
import { HighlightedJson } from './HighlightedJson'

import type { QueryOperation } from './documentsQuery'
import type { DatabaseQueryResult } from '../../types'

export type ViewMode = 'documents' | 'table'

export function OperationTabs({
  operation,
  historyOpen,
  onSelectOperation,
  onToggleHistory,
}: {
  operation: QueryOperation
  historyOpen: boolean
  onSelectOperation: (operation: QueryOperation) => void
  onToggleHistory: () => void
}) {
  return (
    <div className="flex shrink-0 items-center justify-between border-b border-zGray-800 bg-zGray-900/55 px-3">
      <div className="flex h-10 items-end gap-1">
        {OPERATIONS.map((candidate) => (
          <button
            key={candidate.value}
            type="button"
            title={candidate.description}
            onClick={() => onSelectOperation(candidate.value)}
            className={`h-10 border-b-2 px-3 text-[11px] ${operation === candidate.value ? 'border-zViolet-accent text-main' : 'border-transparent text-tertiary hover:text-secondary'}`}
          >
            {candidate.label}
          </button>
        ))}
      </div>
      <button
        type="button"
        onClick={onToggleHistory}
        className={`flex items-center gap-1.5 rounded px-2 py-1 text-[10.5px] ${historyOpen ? 'bg-zGray-700 text-main' : 'text-tertiary hover:bg-zGray-800 hover:text-main'}`}
      >
        <History className="h-3.5 w-3.5" />
        History
      </button>
    </div>
  )
}

export function ResultsPager({
  pageable,
  page,
  loading,
  skip,
  canNext,
  onPrevious,
  onNext,
}: {
  pageable: boolean
  page: number
  loading: boolean
  skip: number
  canNext: boolean
  onPrevious: () => void
  onNext: () => void
}) {
  return (
    <div className="flex h-10 shrink-0 items-center justify-end gap-2 border-t border-zGray-800 px-3 text-[10.5px] text-tertiary">
      {pageable ? (
        <>
          <span>Page {page}</span>
          <button
            onClick={onPrevious}
            disabled={loading || skip === 0}
            className="rounded border border-zGray-800 p-1 disabled:opacity-35"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={onNext}
            disabled={loading || !canNext}
            className="rounded border border-zGray-800 p-1 disabled:opacity-35"
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </>
      ) : (
        <span>Single bounded result</span>
      )}
    </div>
  )
}

export function ResultsToolbar({
  result,
  view,
  onViewChange,
  onExport,
}: {
  result: DatabaseQueryResult | null
  view: ViewMode
  onViewChange: (view: ViewMode) => void
  onExport: (kind: 'json' | 'csv') => void
}) {
  return (
    <div className="flex h-10 shrink-0 items-center justify-between border-b border-zGray-800 px-3">
      <div className="flex items-center gap-2 text-[10.5px] text-tertiary">
        <ShieldCheck className="h-3.5 w-3.5 text-success" />
        <span>Read-only gateway</span>
        {result && (
          <>
            <span>·</span>
            <span>
              {result.rowCount} result{result.rowCount === 1 ? '' : 's'}
            </span>
            <span>·</span>
            <span>{result.durationMs} ms</span>
          </>
        )}
        {result?.truncated && (
          <span className="rounded bg-warning/10 px-1.5 py-0.5 text-warning">bounded result</span>
        )}
        {Boolean(result?.redactedFields.length) && (
          <span className="rounded bg-warning/10 px-1.5 py-0.5 text-warning">
            {result?.redactedFields.length} protected field(s)
          </span>
        )}
      </div>
      <div className="flex items-center gap-1">
        <button
          onClick={() => onExport('json')}
          disabled={!result}
          className="flex items-center gap-1 rounded px-2 py-1 text-[10.5px] text-tertiary hover:bg-zGray-800 hover:text-main disabled:opacity-40"
        >
          <Download className="h-3.5 w-3.5" />
          JSON
        </button>
        <button
          onClick={() => onExport('csv')}
          disabled={!result}
          className="rounded px-2 py-1 text-[10.5px] text-tertiary hover:bg-zGray-800 hover:text-main disabled:opacity-40"
        >
          CSV
        </button>
        <span className="mx-1 h-4 w-px bg-zGray-800" />
        <button
          onPointerDown={(e) => {
            if (e.button !== 0) return
            onViewChange('documents')
          }}
          onClick={(e) => {
            if (e.detail !== 0) return
            onViewChange('documents')
          }}
          className={`rounded p-1.5 ${view === 'documents' ? 'bg-zGray-700 text-main' : 'text-tertiary hover:text-main'}`}
          title="Document view"
        >
          <Braces className="h-3.5 w-3.5" />
        </button>
        <button
          onPointerDown={(e) => {
            if (e.button !== 0) return
            onViewChange('table')
          }}
          onClick={(e) => {
            if (e.detail !== 0) return
            onViewChange('table')
          }}
          className={`rounded p-1.5 ${view === 'table' ? 'bg-zGray-700 text-main' : 'text-tertiary hover:text-main'}`}
          title="Table view"
        >
          <List className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  )
}

export function ResultsBody({
  loading,
  result,
  rows,
  columns,
  view,
  operation,
}: {
  loading: boolean
  result: DatabaseQueryResult | null
  rows: unknown[]
  columns: string[]
  view: ViewMode
  operation: QueryOperation
}) {
  return (
    <div className="min-h-0 flex-1 overflow-auto">
      {loading && !result ? (
        <div className="flex h-full items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-tertiary" />
        </div>
      ) : rows.length === 0 ? (
        <div className="flex h-full items-center justify-center text-[11.5px] text-tertiary">
          Run the {operation === 'aggregate' ? 'pipeline' : 'query'} to see results.
        </div>
      ) : view === 'documents' ? (
        <div className="space-y-2 p-3">
          {rows.map((row, index) => (
            <div
              key={index}
              className="overflow-x-auto rounded-lg border border-zGray-800 bg-zGray-900/65 p-3"
            >
              <HighlightedJson value={row} />
            </div>
          ))}
        </div>
      ) : (
        <div className="min-w-max">
          <table className="w-full text-left text-[10.5px]">
            <thead className="sticky top-0 z-10 bg-zGray-900 text-tertiary">
              <tr>
                {columns.map((column) => (
                  <th
                    key={column}
                    className="border-b border-r border-zGray-800 px-3 py-2 font-medium last:border-r-0"
                  >
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={index} className="border-b border-zGray-800/70">
                  {columns.map((column) => (
                    <td
                      key={column}
                      className="max-w-80 truncate border-r border-zGray-800/50 px-3 py-2 font-mono text-secondary last:border-r-0"
                      title={displayValue(
                        row && typeof row === 'object' && !Array.isArray(row)
                          ? (row as Record<string, unknown>)[column]
                          : row,
                      )}
                    >
                      {displayValue(
                        row && typeof row === 'object' && !Array.isArray(row)
                          ? (row as Record<string, unknown>)[column]
                          : row,
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
