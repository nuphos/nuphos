import { LayoutDashboard } from 'lucide-react'
import { useEffect, useState } from 'react'

import { api, parseAtlasError } from '../api'

import { CenteredError, CenteredMessage } from './gcp-dashboard/Centered'
import { GcpDashboardDetailView } from './gcp-dashboard/GcpDashboardDetailView'
import { useResetOnKey } from './useResetOnKey'

import type { GcpMonitoringDashboardSummary } from '../types'
import type { Props } from './gcp-dashboard/shared'

export function GcpDashboardBrowserView(props: Props) {
  const [dashboards, setDashboards] = useState<GcpMonitoringDashboardSummary[] | null>(null)
  const [selected, setSelected] = useState<GcpMonitoringDashboardSummary | null>(null)
  const [error, setError] = useState<string | null>(null)

  const identityKey = `${props.teamId}|${props.projectId}|${props.serviceAccountId ?? ''}`

  useResetOnKey(identityKey, () => setSelected(null))
  useResetOnKey(`${identityKey}|${String(props.refreshKey ?? '')}`, () => setError(null))

  useEffect(() => {
    let cancelled = false

    if (!dashboards) props.onLoading?.(true)
    api
      .atlasListGcpMonitoringDashboards(props.teamId, props.projectId, props.serviceAccountId)
      .then((items) => {
        if (cancelled) return
        setDashboards(items)
        if (!selected) props.onCount?.(items.length)
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(parseAtlasError(reason).message)
      })
      .finally(() => {
        if (!cancelled) props.onLoading?.(false)
      })

    return () => {
      cancelled = true
    }
    // Selected is deliberately excluded: opening a dashboard must not refetch
    // the list, while toolbar refreshes still do.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.teamId, props.projectId, props.serviceAccountId, props.refreshKey])

  if (selected) {
    return (
      <GcpDashboardDetailView
        {...props}
        summary={selected}
        onBack={() => {
          setSelected(null)
          props.onCount?.(dashboards?.length ?? 0)
        }}
      />
    )
  }

  if (error) return <CenteredError message={error} />
  if (!dashboards) return <CenteredMessage>Loading dashboards…</CenteredMessage>

  const query = (props.filter ?? '').trim().toLowerCase()
  const filtered = query
    ? dashboards.filter(
        (dashboard) =>
          dashboard.displayName.toLowerCase().includes(query) ||
          dashboard.id.toLowerCase().includes(query) ||
          Object.entries(dashboard.labels).some(([key, value]) =>
            `${key}:${value}`.toLowerCase().includes(query),
          ),
      )
    : dashboards

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-auto scrollbar-thin">
        {filtered.length === 0 ? (
          <div className="pt-12 text-center text-[12.5px] text-tertiary">
            {dashboards.length === 0
              ? 'No custom Cloud Monitoring dashboards found in this project.'
              : `No dashboards match “${props.filter ?? ''}”.`}
          </div>
        ) : (
          <>
            {/* The count now lives in the toolbar's "N items"; this keeps only the
                provenance note the toolbar has no room for. */}
            <div className="px-6 pt-3 pb-1 text-[11px] text-tertiary">
              Provider-owned dashboards · read-only
            </div>
            {filtered.map((dashboard) => (
              <button
                key={dashboard.id}
                type="button"
                onPointerDown={(event) => {
                  if (event.button !== 0) return
                  setSelected(dashboard)
                }}
                onClick={(event) => {
                  // Keyboard only — pointer presses already fired at pointerdown.
                  if (event.detail !== 0) return
                  setSelected(dashboard)
                }}
                className="flex w-full items-center gap-3 border-b border-zGray-800/40 px-6 py-3 text-left transition-colors hover:bg-zGray-850"
              >
                <LayoutDashboard
                  className="h-4 w-4 flex-shrink-0 text-zViolet-accent"
                  strokeWidth={1.8}
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] text-main">{dashboard.displayName}</div>
                  <div className="mt-0.5 truncate font-mono text-[10.5px] text-tertiary">
                    {dashboard.id}
                  </div>
                </div>
                {Object.entries(dashboard.labels)
                  .slice(0, 4)
                  .map(([key, value]) => (
                    <span
                      key={key}
                      className="max-w-36 truncate rounded bg-zGray-800/60 px-1.5 py-px text-[10.5px] text-tertiary"
                      title={`${key}=${value}`}
                    >
                      {key}={value}
                    </span>
                  ))}
              </button>
            ))}
          </>
        )}
      </div>
    </div>
  )
}
