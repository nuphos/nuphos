import { ChevronDown, ChevronRight, RefreshCw } from 'lucide-react'
import { useEffect, useState } from 'react'

import { api, parseAtlasError } from '../../api'
import { AppSelect } from '../../components/ui/select'
import { useResetOnKey } from '../useResetOnKey'

import { CenteredError, CenteredMessage } from './Centered'
import { DashboardDetailHeader } from './DashboardDetailHeader'
import { GcpDashboardPanel } from './GcpDashboardPanel'
import { FILTER_DEBOUNCE_MS, RANGE_OPTIONS } from './shared'

import type { Props } from './shared'
import type { GcpMonitoringDashboard, GcpMonitoringDashboardSummary } from '../../types'

export function GcpDashboardDetailView({
  teamId,
  projectId,
  serviceAccountId,
  refreshKey,
  summary,
  onBack,
  onCount,
  onLoading,
  onOpenAgentChat,
}: Props & { summary: GcpMonitoringDashboardSummary; onBack: () => void }) {
  const [dashboard, setDashboard] = useState<GcpMonitoringDashboard | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [rangeMinutes, setRangeMinutes] = useState(60)
  const [queryTick, setQueryTick] = useState(0)
  const [definitionTick, setDefinitionTick] = useState(0)
  const [filterValues, setFilterValues] = useState<Record<string, string>>({})
  const [appliedFilterValues, setAppliedFilterValues] = useState<Record<string, string>>({})
  const [groupOpen, setGroupOpen] = useState<Record<string, boolean | undefined>>({})

  useResetOnKey(summary.id, () => {
    setFilterValues({})
    setAppliedFilterValues({})
  })

  useEffect(() => {
    const timer = window.setTimeout(() => setAppliedFilterValues(filterValues), FILTER_DEBOUNCE_MS)

    return () => window.clearTimeout(timer)
  }, [filterValues])

  // `onCount` / `onLoading` are also deps of the fetch below, but they are
  // stable callbacks with no stringifiable identity — the key covers the data
  // inputs, which are what an error can be stale for.
  useResetOnKey(
    `${teamId}|${projectId}|${serviceAccountId ?? ''}|${summary.id}|${String(refreshKey ?? '')}|${String(definitionTick)}`,
    () => setError(null),
  )

  useEffect(() => {
    let cancelled = false

    onLoading?.(true)
    api
      .atlasGetGcpMonitoringDashboard(teamId, projectId, summary.id, serviceAccountId)
      .then((value) => {
        if (cancelled) return
        setDashboard(value)
        onCount?.(value.widgets.filter((widget) => widget.kind !== 'filter-control').length)
        setFilterValues((current) => {
          const next = { ...current }

          for (const dashboardFilter of value.filters) {
            if (!(dashboardFilter.id in next)) {
              next[dashboardFilter.id] = dashboardFilter.defaultValue || '*'
            }
          }

          return next
        })
        setGroupOpen((current) => {
          const next = { ...current }

          for (const widget of value.widgets) {
            if (widget.kind === 'group' && !(widget.ref in next)) {
              next[widget.ref] = !widget.collapsed
            }
          }

          return next
        })
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(parseAtlasError(reason).message)
      })
      .finally(() => {
        if (!cancelled) onLoading?.(false)
      })

    return () => {
      cancelled = true
    }
  }, [
    teamId,
    projectId,
    serviceAccountId,
    summary.id,
    refreshKey,
    definitionTick,
    onCount,
    onLoading,
  ])

  if (error) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <DashboardDetailHeader summary={summary} onBack={onBack} />
        <CenteredError message={error} />
      </div>
    )
  }
  if (!dashboard) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <DashboardDetailHeader summary={summary} onBack={onBack} />
        <CenteredMessage>Loading dashboard…</CenteredMessage>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <DashboardDetailHeader summary={summary} onBack={onBack} />
      <div className="flex flex-wrap items-center gap-2 border-b border-zGray-800/60 px-4 py-2">
        {dashboard.filters.map((dashboardFilter) =>
          dashboardFilter.options.length > 0 ? (
            <div key={dashboardFilter.id} className="flex items-center gap-1.5">
              <span className="text-[11px] text-tertiary">{dashboardFilter.label}</span>
              <AppSelect
                value={filterValues[dashboardFilter.id] ?? '*'}
                onValueChange={(value) =>
                  setFilterValues((current) => ({ ...current, [dashboardFilter.id]: value }))
                }
                options={[
                  { value: '*', label: 'All' },
                  ...dashboardFilter.options.map((value) => ({ value, label: value })),
                ]}
                triggerClassName="h-7 min-w-[130px] px-2 text-[11.5px]"
                ariaLabel={dashboardFilter.label}
              />
            </div>
          ) : (
            <label key={dashboardFilter.id} className="flex items-center gap-1.5">
              <span className="text-[11px] text-tertiary">{dashboardFilter.label}</span>
              <input
                value={
                  filterValues[dashboardFilter.id] === '*'
                    ? ''
                    : (filterValues[dashboardFilter.id] ?? '')
                }
                onChange={(event) =>
                  setFilterValues((current) => ({
                    ...current,
                    [dashboardFilter.id]: event.target.value || '*',
                  }))
                }
                placeholder="All"
                className="h-7 w-[140px] rounded border border-zGray-800 bg-field px-2 text-[11.5px] text-main outline-none focus:border-zViolet-accent/60"
              />
            </label>
          ),
        )}
        <div className="ml-auto flex items-center gap-1">
          {RANGE_OPTIONS.map((option) => (
            <button
              key={option.minutes}
              type="button"
              onPointerDown={(event) => {
                if (event.button !== 0) return
                setRangeMinutes(option.minutes)
              }}
              onClick={(event) => {
                if (event.detail !== 0) return
                setRangeMinutes(option.minutes)
              }}
              className={`h-6 rounded px-2 text-[11px] font-medium ${
                rangeMinutes === option.minutes
                  ? 'bg-zViolet-accent/15 text-zViolet-accent'
                  : 'text-tertiary hover:bg-zGray-850 hover:text-main'
              }`}
            >
              {option.label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => {
              setDefinitionTick((value) => value + 1)
              setQueryTick((value) => value + 1)
            }}
            className="ml-1 flex h-7 w-7 items-center justify-center rounded border border-zGray-800 text-tertiary hover:bg-zGray-850 hover:text-main"
            title="Refresh dashboard definition and data"
          >
            <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.8} />
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-4 scrollbar-thin">
        {dashboard.widgets.length === 0 ? (
          <div className="py-12 text-center text-[12.5px] text-tertiary">
            This dashboard has no widgets.
          </div>
        ) : (
          <div
            className="relative"
            style={{
              display: 'grid',
              gridTemplateColumns: `repeat(${String(dashboard.columns)}, minmax(0, 1fr))`,
              gridAutoRows: `${String(dashboard.rowHeight)}px`,
              gap: 8,
            }}
          >
            {dashboard.widgets.map((widget) => {
              if (widget.kind === 'filter-control') return null
              if (widget.groupRef && groupOpen[widget.groupRef] === false) return null
              const style = {
                gridColumn: `${String(widget.layout.x + 1)} / span ${String(Math.min(widget.layout.w, dashboard.columns))}`,
                gridRow: `${String(widget.layout.y + 1)} / span ${String(widget.layout.h)}`,
                minHeight: 0,
                minWidth: 0,
                zIndex: widget.kind === 'group' ? 2 : 1,
              }

              if (widget.kind === 'group') {
                const open = groupOpen[widget.ref] ?? !widget.collapsed

                return (
                  <div
                    key={widget.ref}
                    style={style}
                    className="pointer-events-none outline outline-1 outline-zViolet-accent/30"
                  >
                    <button
                      type="button"
                      onClick={() =>
                        setGroupOpen((current) => ({ ...current, [widget.ref]: !open }))
                      }
                      className="pointer-events-auto flex h-8 items-center gap-1.5 border-b border-zViolet-accent/20 bg-zGray-950/95 px-3 text-[11.5px] font-medium text-secondary hover:text-main"
                    >
                      {open ? (
                        <ChevronDown className="h-3.5 w-3.5" strokeWidth={1.8} />
                      ) : (
                        <ChevronRight className="h-3.5 w-3.5" strokeWidth={1.8} />
                      )}
                      {widget.title}
                    </button>
                  </div>
                )
              }

              return (
                <div key={widget.ref} style={style}>
                  <GcpDashboardPanel
                    teamId={teamId}
                    projectId={projectId}
                    serviceAccountId={serviceAccountId}
                    dashboard={dashboard}
                    widget={widget}
                    rangeMinutes={rangeMinutes}
                    filters={appliedFilterValues}
                    refreshTick={queryTick + (refreshKey ?? 0)}
                    onOpenAgentChat={onOpenAgentChat}
                  />
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
