import { useEffect, useMemo, useRef, useState } from 'react'

import { toast } from '../../components/ui/toast'
import { listLokiLabels, listLokiLabelValues, queryLokiLogs } from '../../grafana/client'

import {
  buildExpr,
  getWindowMs,
  LIVE_TAIL_INTERVAL_MS,
  PREFERRED_LABELS,
  RANGE_OPTIONS,
} from './logql'

import type { LabelFilter } from './logql'
import type { DatasourceSummary, GrafanaTarget } from '../../grafana/client'
import type { DataFrame } from '../../grafana/types'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'

type Params = {
  target: GrafanaTarget
  datasource: DatasourceSummary
  onOpenAgentChat?: (prompt: string, options?: { send?: boolean }) => void
}

export function useLogExplorer({ target, datasource, onOpenAgentChat }: Params) {
  const [labels, setLabels] = useState<string[] | null>(null)
  const [filters, setFilters] = useState<LabelFilter[]>([{ id: 0, name: '', value: '' }])
  const [keyword, setKeyword] = useState('')
  const [rangeMs, setRangeMs] = useState(RANGE_OPTIONS[1].ms)
  const [maxLines, setMaxLines] = useState(200)
  const [frames, setFrames] = useState<DataFrame[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [live, setLive] = useState(false)
  // Values per label name, fetched lazily when a filter picks that label. A
  // name with no entry is still in flight (the select stays disabled with a
  // loading hint); `pendingLabelsRef` is what stops a re-render refetching it.
  const [labelValues, setLabelValues] = useState<Record<string, string[]>>({})
  const pendingLabelsRef = useRef(new Set<string>())
  const composingRef = useRef(false)
  const inFlightRef = useRef(false)
  const filterIdRef = useRef(1)

  const expr = useMemo(() => buildExpr(filters, keyword), [filters, keyword])

  useEffect(() => {
    let cancelled = false

    listLokiLabels(target, datasource.uid, getWindowMs(rangeMs))
      .then((names) => {
        if (cancelled) return
        setLabels(names)
        // Seed the first filter with the most useful available label.
        setFilters((cur) => {
          if (cur.length !== 1 || cur[0].name) return cur
          const seed = PREFERRED_LABELS.find((x) => names.includes(x)) ?? names[0]

          return seed ? [{ ...cur[0], name: seed }] : cur
        })
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          toast.apiError('Failed to load log labels', e)
        }
      })

    return () => {
      cancelled = true
    }
    // Label names are stable enough across ranges — fetch once per datasource.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target.teamId, target.instanceId, datasource.uid])

  useEffect(() => {
    const pending = pendingLabelsRef.current
    const missing = filters
      .map((f) => f.name)
      .filter((name) => name && !(name in labelValues) && !pending.has(name))

    if (missing.length === 0) return
    let cancelled = false

    for (const name of missing) {
      // Mark as pending so a re-render doesn't refetch while in flight.
      pending.add(name)
      listLokiLabelValues(target, datasource.uid, name, getWindowMs(rangeMs))
        .then((values) => {
          pending.delete(name)
          if (!cancelled) setLabelValues((cur) => ({ ...cur, [name]: values }))
        })
        .catch(() => {
          // Unblock the select; reopening the label retries via `missing`.
          pending.delete(name)
        })
    }

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters, target.teamId, target.instanceId, datasource.uid])

  async function runQuery(opts?: { silent?: boolean }) {
    if (!expr) {
      toast.error('No label filter', 'Pick at least one label (e.g. instance) before running.')

      return
    }
    if (inFlightRef.current) return
    inFlightRef.current = true
    if (!opts?.silent) setLoading(true)
    try {
      const rows = await queryLokiLogs(target, datasource.uid, {
        expr,
        maxLines,
        ...getWindowMs(rangeMs),
      })

      setFrames(rows)
    } catch (e) {
      toast.apiError('Log query failed', e, {
        fallback: 'Check your connection and try again.',
      })
      setLive(false)
    } finally {
      inFlightRef.current = false
      if (!opts?.silent) setLoading(false)
    }
  }

  useEffect(() => {
    if (!live) return
    const timer = setInterval(() => void runQuery({ silent: true }), LIVE_TAIL_INTERVAL_MS)

    return () => clearInterval(timer)
    // Restart the ticker when the query inputs change so it tails the new query.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, expr, rangeMs, maxLines])

  function onKeywordKeyDown(e: ReactKeyboardEvent<HTMLInputElement>) {
    const native = e.nativeEvent as globalThis.KeyboardEvent & { keyCode?: number }

    if (
      e.key === 'Enter' &&
      !loading &&
      !composingRef.current &&
      !native.isComposing &&
      native.keyCode !== 229
    ) {
      e.preventDefault()
      void runQuery()
    }
  }

  function updateFilter(id: number, patch: Partial<LabelFilter>) {
    setFilters((cur) => cur.map((f) => (f.id === id ? { ...f, ...patch } : f)))
  }

  function askAgent() {
    if (!expr || !onOpenAgentChat) return
    const rangeLabel = RANGE_OPTIONS.find((x) => x.ms === rangeMs)?.label ?? `${String(rangeMs)}ms`

    onOpenAgentChat(
      [
        'Investigate these logs for me:',
        `- Grafana: ${datasource.name} (loki datasource uid ${datasource.uid})`,
        `- LogQL: ${expr}`,
        `- Time window: last ${rangeLabel}`,
        'Summarize what is happening and flag anything abnormal.',
      ].join('\n'),
      { send: false },
    )
  }

  return {
    labels,
    filters,
    setFilters,
    keyword,
    setKeyword,
    rangeMs,
    setRangeMs,
    maxLines,
    setMaxLines,
    frames,
    loading,
    live,
    setLive,
    labelValues,
    composingRef,
    filterIdRef,
    expr,
    runQuery,
    onKeywordKeyDown,
    updateFilter,
    askAgent,
  }
}
