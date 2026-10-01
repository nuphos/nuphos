import { ArrowLeft, Play, Search } from 'lucide-react'
import { useRef, useState } from 'react'

import { PageHeader } from '../components/PageHeader'
import { InputGroup, InputGroupInput } from '../components/ui/input-group'
import { AppSelect } from '../components/ui/select'
import { getTempoTrace, searchTempoTraces } from '../grafana/client'

import { formatTraceError, isTraceId, validateTraceQuery } from './grafana-trace/notices'
import { ColumnResizeHandle } from './grafana-trace/resize-handles'
import { TraceDetail } from './grafana-trace/TraceDetail'
import { TraceNoticeBanner, TraceResults } from './grafana-trace/TraceResults'

import type { TraceNotice } from './grafana-trace/notices'
import type {
  DatasourceSummary,
  GrafanaTarget,
  TempoTrace,
  TempoTraceSummary,
} from '../grafana/client'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'

type Props = {
  target: GrafanaTarget
  datasource: DatasourceSummary
  onBack: () => void
}

const RANGE_OPTIONS = [
  { label: '15m', ms: 15 * 60_000 },
  { label: '1h', ms: 60 * 60_000 },
  { label: '6h', ms: 6 * 60 * 60_000 },
  { label: '24h', ms: 24 * 60 * 60_000 },
]

function getWindowSecs(rangeMs: number) {
  const endSec = Math.floor(Date.now() / 1000)
  const startSec = Math.floor((Date.now() - rangeMs) / 1000)

  return { startSec, endSec }
}

export function GrafanaTraceExplorerView({ target, datasource, onBack }: Props) {
  const [query, setQuery] = useState('{}')
  const [rangeMs, setRangeMs] = useState(RANGE_OPTIONS[1].ms)
  const [limit, setLimit] = useState(20)
  const [traces, setTraces] = useState<TempoTraceSummary[]>([])
  const [selectedTrace, setSelectedTrace] = useState<TempoTrace | null>(null)
  const [selectedSpanId, setSelectedSpanId] = useState<string | null>(null)
  const [resultsPanePct, setResultsPanePct] = useState(34)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<TraceNotice | null>(null)
  const composingRef = useRef(false)
  const contentRef = useRef<HTMLDivElement | null>(null)

  async function runSearch() {
    const trimmed = query.trim()
    const validation = validateTraceQuery(trimmed)

    if (validation) {
      setError(validation)
      setSelectedTrace(null)
      setSelectedSpanId(null)

      return
    }
    if (isTraceId(trimmed)) {
      await openTrace(trimmed)

      return
    }
    setLoading(true)
    setError(null)
    setSelectedTrace(null)
    setSelectedSpanId(null)
    try {
      const rows = await searchTempoTraces(target, datasource.uid, {
        query: trimmed || '{}',
        limit,
        ...getWindowSecs(rangeMs),
      })

      setTraces(rows)
    } catch (e) {
      setError(formatTraceError(e, 'search'))
    } finally {
      setLoading(false)
    }
  }

  async function openTrace(traceId: string) {
    if (!traceId.trim()) return
    setLoading(true)
    setError(null)
    try {
      const trace = await getTempoTrace(
        target,
        datasource.uid,
        traceId.trim(),
        getWindowSecs(rangeMs),
      )

      setSelectedTrace(trace)
      setSelectedSpanId(trace.spans[0]?.spanId ?? null)
      setQuery(trace.traceId)
      if (trace.searchedRangeMs && trace.searchedRangeMs > rangeMs) {
        setRangeMs(trace.searchedRangeMs)
      }
      setTraces((cur) =>
        cur.some((x) => x.traceId === trace.traceId) ? cur : [{ traceId: trace.traceId }, ...cur],
      )
    } catch (e) {
      setError(formatTraceError(e, 'trace'))
    } finally {
      setLoading(false)
    }
  }

  function onQueryKeyDown(e: ReactKeyboardEvent<HTMLInputElement>) {
    const native = e.nativeEvent as globalThis.KeyboardEvent & {
      keyCode?: number
    }

    if (
      e.key === 'Enter' &&
      !loading &&
      !composingRef.current &&
      !native.isComposing &&
      native.keyCode !== 229
    ) {
      e.preventDefault()
      void runSearch()
    }
  }

  return (
    <div className="h-full flex flex-col min-h-0">
      <PageHeader
        title="Trace Explorer"
        subtitle={`${datasource.name} · ${datasource.uid}`}
        actions={
          <button
            onClick={onBack}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[12.5px] text-secondary hover:text-main hover:bg-zGray-800/60"
          >
            <ArrowLeft className="w-3.5 h-3.5" strokeWidth={1.8} />
            Datasources
          </button>
        }
      />

      <div className="border-b border-zGray-800/60 p-4 space-y-3">
        <div className="flex items-center gap-2">
          <InputGroup className="flex-1 flex items-center gap-2 h-8 px-2.5 rounded-md bg-field border border-zGray-800 transition-colors min-w-0">
            <Search className="w-3.5 h-3.5 text-tertiary flex-shrink-0" strokeWidth={1.8} />
            <InputGroupInput
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onQueryKeyDown}
              onCompositionStart={() => {
                composingRef.current = true
              }}
              onCompositionEnd={() => {
                composingRef.current = false
              }}
              placeholder='TraceQL search or trace ID, e.g. { resource.service.name = "api" }'
              className="text-[12.5px] text-main placeholder:text-tertiary font-mono"
            />
          </InputGroup>
          <AppSelect
            value={String(rangeMs)}
            onValueChange={(nextValue) => setRangeMs(Number(nextValue))}
            ariaLabel="Trace search range"
            triggerClassName="h-8 w-[72px] border-zGray-800 bg-zGray-900 px-2 text-[12.5px]"
            options={RANGE_OPTIONS.map((option) => ({
              value: String(option.ms),
              label: option.label,
            }))}
          />
          <input
            type="number"
            min={1}
            max={100}
            value={limit}
            onChange={(e) => setLimit(Math.max(1, Math.min(100, Number(e.target.value) || 1)))}
            className="h-8 w-16 bg-field border border-zGray-800 rounded-md px-2 text-[12.5px] text-main outline-none focus:border-zViolet-500"
            aria-label="Trace search limit"
          />
          <button
            onClick={() => void runSearch()}
            disabled={loading}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-zViolet-500 hover:bg-zViolet-400 disabled:opacity-50 text-white text-[12.5px]"
          >
            <Play className="w-3.5 h-3.5" strokeWidth={2} />
            Run
          </button>
        </div>
      </div>

      {error && <TraceNoticeBanner notice={error} onDismiss={() => setError(null)} />}

      <div className="flex-1 min-h-0 overflow-x-auto overflow-y-hidden scrollbar-thin">
        <div ref={contentRef} className="h-full min-w-[1120px] flex overflow-hidden">
          <div
            className="min-h-0 min-w-[220px] h-full"
            style={{ width: `${String(resultsPanePct)}%` }}
          >
            <TraceResults
              traces={traces}
              loading={loading}
              selectedTraceId={selectedTrace?.traceId ?? null}
              onOpen={(id) => void openTrace(id)}
            />
          </div>
          <ColumnResizeHandle
            containerRef={contentRef}
            valuePct={resultsPanePct}
            onChange={setResultsPanePct}
            minPct={20}
            maxPct={55}
            label="Resize trace results column"
          />
          <div className="min-h-0 min-w-0 flex-1 h-full">
            <TraceDetail
              trace={selectedTrace}
              selectedSpanId={selectedSpanId}
              onSelectSpan={setSelectedSpanId}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
