import { ExternalLink, Eye } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { api, parseAtlasError } from '../../api'
import { PanelFrame } from '../../grafana/components/PanelFrame'
import { TextPanel } from '../../grafana/components/TextPanel'
import { gcpDashboardWatchPrompt } from '../../lib/monitoringWatch'
import { WatchDestinationDialog } from '../MonitoringView'
import { useResetOnKey } from '../useResetOnKey'

import { GcpWidgetBody, UnsupportedPanel } from './GcpWidgetBody'

import type { Props } from './shared'
import type { DataFrame } from '../../grafana/types'
import type {
  GcpMonitoringDashboard,
  GcpMonitoringDashboardQueryResult,
  GcpMonitoringDashboardWidget,
} from '../../types'

// The synchronous prelude of a panel load: what the panel shows before — or
// instead of — a query round-trip. Seeds the initial state and is re-applied
// whenever the load inputs change. An absent `frames` means "keep the stale
// data visible while the refetch runs".
function preloadState(widget: GcpMonitoringDashboardWidget): {
  frames?: DataFrame[]
  loading: boolean
  error: string | null
} {
  if (widget.kind === 'text' || widget.kind === 'unsupported') {
    return { loading: false, error: null }
  }
  if (widget.queries.length === 0) return { frames: [], loading: false, error: null }
  if (widget.queries.every((query) => !query.supported)) {
    return {
      frames: [],
      loading: false,
      error: `Saved ${widget.queries.map((query) => query.sourceType).join(', ')} queries are not supported in this release.`,
    }
  }

  return { loading: true, error: null }
}

export function GcpDashboardPanel({
  teamId,
  projectId,
  serviceAccountId,
  dashboard,
  widget,
  rangeMinutes,
  filters,
  refreshTick,
  onOpenAgentChat,
}: {
  teamId: string
  projectId: string
  serviceAccountId?: string
  dashboard: GcpMonitoringDashboard
  widget: GcpMonitoringDashboardWidget
  rangeMinutes: number
  filters: Record<string, string>
  refreshTick: number
  onOpenAgentChat: Props['onOpenAgentChat']
}) {
  const [frames, setFrames] = useState<DataFrame[] | null>(
    () => preloadState(widget).frames ?? null,
  )
  const [unit, setUnit] = useState<string | undefined>(undefined)
  const [loading, setLoading] = useState(() => preloadState(widget).loading)
  const [error, setError] = useState<string | null>(() => preloadState(widget).error)
  const [truncated, setTruncated] = useState(false)
  const [watchOpen, setWatchOpen] = useState(false)
  const requestRef = useRef(0)

  const supportedQueries = useMemo(
    () => widget.queries.filter((query) => query.supported),
    [widget.queries],
  )
  const filtersKey = useMemo(() => JSON.stringify(filters), [filters])

  const load = useCallback(() => {
    if (widget.kind === 'text' || widget.kind === 'unsupported') return
    if (supportedQueries.length === 0) return
    const request = ++requestRef.current
    const endMs = Date.now()
    const startMs = endMs - rangeMinutes * 60_000

    return Promise.all(
      supportedQueries.map((query) =>
        api.atlasQueryGcpMonitoringDashboardWidget(
          teamId,
          projectId,
          dashboard.id,
          widget.ref,
          {
            datasetIndex: query.index,
            startMs,
            endMs,
            filters,
          },
          serviceAccountId,
        ),
      ),
    )
      .then((results) => {
        if (requestRef.current !== request) return
        setFrames(
          results.flatMap((result, resultIndex) =>
            framesFromResult(result, supportedQueries[resultIndex]?.index ?? resultIndex),
          ),
        )
        setUnit(
          gcpDisplayUnit(results.find((result) => result.unit)?.unit ?? widget.queries[0]?.unit),
        )
        setTruncated(results.some((result) => result.truncated))
      })
      .catch((reason: unknown) => {
        if (requestRef.current !== request) return
        setFrames([])
        setError(parseAtlasError(reason).message)
      })
      .finally(() => {
        if (requestRef.current === request) setLoading(false)
      })
  }, [
    teamId,
    projectId,
    serviceAccountId,
    dashboard.id,
    widget,
    supportedQueries,
    rangeMinutes,
    filtersKey,
    refreshTick,
    // The serialized key is the dependency; using the object as well would
    // retrigger if a parent creates an equivalent map.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ])

  useResetOnKey(
    `${teamId}|${projectId}|${serviceAccountId ?? ''}|${dashboard.id}|${widget.ref}|${String(rangeMinutes)}|${filtersKey}|${String(refreshTick)}`,
    () => {
      const next = preloadState(widget)

      if (next.frames) setFrames(next.frames)
      setLoading(next.loading)
      setError(next.error)
    },
  )

  useEffect(() => {
    void load()
  }, [load])

  const partial = supportedQueries.length > 0 && supportedQueries.length < widget.queries.length

  return (
    <>
      <PanelFrame
        title={widget.title}
        loading={loading}
        error={error}
        actions={
          <>
            {partial && (
              <span
                className="rounded bg-amber-500/10 px-1.5 py-px text-[9.5px] text-amber-400"
                title="Some saved query types are not supported"
              >
                Partial
              </span>
            )}
            {truncated && (
              <span
                className="text-[9.5px] text-amber-400"
                title="Cloud Monitoring pagination limit reached"
              >
                Truncated
              </span>
            )}
            {widget.queries.length > 0 && (
              <button
                type="button"
                onClick={() => setWatchOpen(true)}
                className="inline-flex h-5 items-center gap-1 rounded px-1.5 text-[10px] text-tertiary hover:bg-zGray-800 hover:text-main"
                title="Watch this saved dashboard panel with the agent"
              >
                <Eye className="h-3 w-3" strokeWidth={1.8} />
                Watch
              </button>
            )}
            <button
              type="button"
              onClick={() => void api.appOpenExternal(dashboard.consoleUrl)}
              className="flex h-5 w-5 items-center justify-center rounded text-tertiary hover:bg-zGray-800 hover:text-main"
              title="Open this dashboard in GCP"
            >
              <ExternalLink className="h-3 w-3" strokeWidth={1.8} />
            </button>
          </>
        }
      >
        {widget.kind === 'unsupported' ? (
          <UnsupportedPanel type={widget.unsupportedType ?? 'unknown'} url={dashboard.consoleUrl} />
        ) : widget.kind === 'text' ? (
          <TextPanel options={{ content: widget.text?.content ?? '' }} />
        ) : frames ? (
          <GcpWidgetBody widget={widget} frames={frames} unit={unit} />
        ) : null}
      </PanelFrame>
      {watchOpen && (
        <WatchDestinationDialog
          subjectName={`${dashboard.displayName} · ${widget.title}`}
          teamId={teamId}
          onClose={() => setWatchOpen(false)}
          onContinue={(destination) => {
            onOpenAgentChat(
              gcpDashboardWatchPrompt(
                projectId,
                serviceAccountId,
                dashboard,
                widget,
                filters,
                destination,
              ),
              { send: false },
            )
            setWatchOpen(false)
          }}
        />
      )}
    </>
  )
}

function framesFromResult(
  result: GcpMonitoringDashboardQueryResult,
  queryIndex: number,
): DataFrame[] {
  return result.series.map((series, seriesIndex) => ({
    refId: `q${String(queryIndex)}s${String(seriesIndex)}`,
    name: series.name,
    fields: [
      { name: 'time', type: 'time' as const, values: series.points.map((point) => point[0]) },
      {
        name: series.name,
        type: 'number' as const,
        labels: series.labels,
        config: { unit: gcpDisplayUnit(result.unit) },
        values: series.points.map((point) => point[1]),
      },
    ],
  }))
}

function gcpDisplayUnit(unit: string | null | undefined): string | undefined {
  if (!unit) return undefined
  switch (unit) {
    case '10^2.%':
      return 'percentunit'
    case '%':
      return 'percent'
    case 'By':
      return 'bytes'
    case 'ms':
    case 's':
      return unit
    default:
      return undefined
  }
}
