import { useCallback, useEffect, useRef, useState } from 'react'

import { api, parseAtlasError } from '../api'

import { DocumentsHistoryPanel } from './mongo/DocumentsHistoryPanel'
import {
  csvCell,
  EMPTY_PIPELINE,
  parseArrayEditor,
  parseObjectEditor,
  parseSort,
  prettyJson,
} from './mongo/documentsQuery'
import { DocumentsQueryBar } from './mongo/DocumentsQueryBar'
import { OperationTabs, ResultsBody, ResultsPager, ResultsToolbar } from './mongo/DocumentsResults'
import { useResetOnKey } from './useResetOnKey'

import type { DatabaseQueryAudit, DatabaseQueryResult, MongoReadQueryInput } from '../types'
import type { QueryOperation } from './mongo/documentsQuery'
import type { ViewMode } from './mongo/DocumentsResults'

export { HighlightedJson } from './mongo/HighlightedJson'

type Props = {
  teamId: string
  connectionId: string
  database: string
  collection: string
}

export function MongoDocumentsExplorer({ teamId, connectionId, database, collection }: Props) {
  const [operation, setOperation] = useState<QueryOperation>('find')
  const [filter, setFilter] = useState('{}')
  const [projection, setProjection] = useState('{}')
  const [sort, setSort] = useState('{}')
  const [pipeline, setPipeline] = useState(EMPTY_PIPELINE)
  const [limit, setLimit] = useState(25)
  const [skip, setSkip] = useState(0)
  const [result, setResult] = useState<DatabaseQueryResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [view, setView] = useState<ViewMode>('documents')
  const [historyOpen, setHistoryOpen] = useState(false)
  const [history, setHistory] = useState<DatabaseQueryAudit[] | null>(null)
  const [historyError, setHistoryError] = useState<string | null>(null)
  const requestVersion = useRef(0)

  const loadHistory = useCallback(async () => {
    setHistoryError(null)
    setHistory(null)
    try {
      const events = await api.atlasListDatabaseQueryAudit(teamId, connectionId, 100)

      setHistory(
        events.filter((event) => event.database === database && event.collection === collection),
      )
    } catch (cause) {
      setHistoryError(parseAtlasError(cause).message)
      setHistory([])
    }
  }, [teamId, connectionId, database, collection])

  const run = useCallback(
    async (nextSkip = 0) => {
      const version = ++requestVersion.current

      setLoading(true)
      setError(null)
      setNotice(null)
      try {
        const base = { operation, database, collection, skip: nextSkip, limit }
        let input: MongoReadQueryInput

        if (operation === 'aggregate') {
          input = { ...base, pipeline: parseArrayEditor('Pipeline', pipeline) }
        } else if (operation === 'count') {
          input = { ...base, filter: parseObjectEditor('Filter', filter) }
        } else {
          input = {
            ...base,
            filter: parseObjectEditor('Filter', filter),
            projection: parseObjectEditor('Project', projection),
            sort: parseSort(sort),
          }
        }
        const next = await api.atlasQueryMongoDatabase(teamId, connectionId, input)

        if (version !== requestVersion.current) return
        setSkip(nextSkip)
        setResult(next)
        if (historyOpen) void loadHistory()
      } catch (cause) {
        if (version !== requestVersion.current) return
        setError(
          cause instanceof SyntaxError
            ? `Invalid JSON: ${cause.message}`
            : parseAtlasError(cause).message,
        )
      } finally {
        if (version === requestVersion.current) setLoading(false)
      }
    },
    [
      operation,
      database,
      collection,
      limit,
      pipeline,
      filter,
      projection,
      sort,
      teamId,
      connectionId,
      historyOpen,
      loadHistory,
    ],
  )

  useResetOnKey(`${database}|${collection}`, () => {
    setOperation('find')
    setFilter('{}')
    setProjection('{}')
    setSort('{}')
    setPipeline(EMPTY_PIPELINE)
    setSkip(0)
    setResult(null)
    setHistory(null)
    setHistoryOpen(false)
    setError(null)
    setNotice(null)
    setLoading(false)
  })
  useEffect(() => {
    requestVersion.current += 1
  }, [database, collection])

  const rows = result?.rows ?? []
  const columns = result?.columns ?? []
  const page = Math.floor(skip / limit) + 1
  const pageable = operation === 'find' || operation === 'aggregate'
  const canNext = pageable && result?.nextSkip !== null && result?.nextSkip !== undefined
  const exportBase = `${database}-${collection}-${operation}-${new Date().toISOString().slice(0, 10)}`

  async function exportRows(kind: 'json' | 'csv') {
    if (!result) return
    const content =
      kind === 'json'
        ? JSON.stringify(result.rows, null, 2)
        : [
            columns.map(csvCell).join(','),
            ...rows.map((row) =>
              columns
                .map((column) =>
                  csvCell(
                    row && typeof row === 'object' && !Array.isArray(row)
                      ? (row as Record<string, unknown>)[column]
                      : row,
                  ),
                )
                .join(','),
            ),
          ].join('\n')

    await api.saveTextFile(`${exportBase}.${kind}`, content)
  }

  function reset() {
    setFilter('{}')
    setProjection('{}')
    setSort('{}')
    setPipeline(EMPTY_PIPELINE)
    setLimit(25)
    setSkip(0)
    setResult(null)
    setError(null)
    setNotice(null)
  }

  function selectOperation(next: QueryOperation) {
    requestVersion.current += 1
    setOperation(next)
    setLoading(false)
    setSkip(0)
    setResult(null)
    setError(null)
    setNotice(null)
  }

  function openHistory() {
    const next = !historyOpen

    setHistoryOpen(next)
    if (next) void loadHistory()
  }

  function loadHistoryEntry(event: DatabaseQueryAudit) {
    const input = event.queryInput

    if (!input) return
    setOperation(input.operation)
    setFilter(prettyJson(input.filter, '{}'))
    setProjection(prettyJson(input.projection, '{}'))
    setSort(prettyJson(input.sort, '{}'))
    setPipeline(prettyJson(input.pipeline, '[]'))
    setLimit(input.limit ?? 25)
    setSkip(input.skip ?? 0)
    setResult(null)
    setError(null)
    setNotice(
      event.queryRedactedFields.length > 0
        ? `${String(event.queryRedactedFields.length)} protected value(s) were redacted in history. Review the query before running it.`
        : 'Query loaded from history. Review it, then run manually.',
    )
    setHistoryOpen(false)
  }

  return (
    <div className="relative flex h-full min-h-0 flex-col overflow-hidden">
      <OperationTabs
        operation={operation}
        historyOpen={historyOpen}
        onSelectOperation={selectOperation}
        onToggleHistory={openHistory}
      />
      <DocumentsQueryBar
        operation={operation}
        filter={filter}
        projection={projection}
        sort={sort}
        pipeline={pipeline}
        limit={limit}
        loading={loading}
        notice={notice}
        error={error}
        onFilterChange={setFilter}
        onProjectionChange={setProjection}
        onSortChange={setSort}
        onPipelineChange={setPipeline}
        onLimitChange={setLimit}
        onRun={() => void run(0)}
        onReset={reset}
      />
      <ResultsToolbar
        result={result}
        view={view}
        onViewChange={setView}
        onExport={(kind) => void exportRows(kind)}
      />
      <ResultsBody
        loading={loading}
        result={result}
        rows={rows}
        columns={columns}
        view={view}
        operation={operation}
      />
      <ResultsPager
        pageable={pageable}
        page={page}
        loading={loading}
        skip={skip}
        canNext={canNext}
        onPrevious={() => void run(Math.max(0, skip - limit))}
        onNext={() => void run(result?.nextSkip ?? skip + limit)}
      />
      {historyOpen && (
        <DocumentsHistoryPanel
          database={database}
          collection={collection}
          history={history}
          historyError={historyError}
          onRefresh={() => void loadHistory()}
          onClose={() => setHistoryOpen(false)}
          onLoadEntry={loadHistoryEntry}
        />
      )}
    </div>
  )
}
