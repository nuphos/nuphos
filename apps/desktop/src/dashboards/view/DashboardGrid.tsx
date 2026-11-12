import { LayoutGrid, MoreHorizontal } from 'lucide-react'

import { t } from '../../i18n'

import { RANGE_PRESETS, rangeLabel } from './helpers'

import type { NuphosDashboard } from '../schema'

export function DashboardGrid({
  dashboards,
  loading,
  onOpen,
  onMenu,
}: {
  dashboards: NuphosDashboard[]
  loading: boolean
  onOpen: (dashboard: NuphosDashboard) => void
  onMenu: (dashboard: NuphosDashboard, position: { x: number; y: number }) => void
}) {
  if (loading) return <div className="h-24 animate-pulse rounded-xl bg-state-selected" />

  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,280px),1fr))] gap-3">
      {dashboards.map((dashboard) => (
        <div
          key={dashboard.id}
          className="group relative min-w-0 rounded-xl border border-line-control hover:bg-state-hover"
          onContextMenu={(event) => {
            event.preventDefault()
            onMenu(dashboard, { x: event.clientX, y: event.clientY })
          }}
        >
          <button
            type="button"
            onClick={() => onOpen(dashboard)}
            className="block w-full px-4 py-4 pr-10 text-left"
          >
            <span className="mb-3 flex items-center gap-2 text-sm font-medium text-main">
              <LayoutGrid className="size-4 shrink-0 text-tertiary" />
              <span className="truncate">{dashboard.name}</span>
            </span>
            <span className="block truncate text-xs text-tertiary">
              {dashboard.rangePreset
                ? (RANGE_PRESETS.find((preset) => preset.key === dashboard.rangePreset)?.label ??
                  rangeLabel(dashboard.timeRange.periodStart, dashboard.timeRange.periodEnd))
                : rangeLabel(dashboard.timeRange.periodStart, dashboard.timeRange.periodEnd)}
            </span>
            <span className="mt-1 block text-xs text-tertiary">
              {t('Updated')} · {new Date(dashboard.updatedAt).toLocaleDateString()}
            </span>
          </button>
          <button
            type="button"
            aria-label={t('More actions')}
            className="absolute right-2 top-3 flex size-7 items-center justify-center rounded-md text-tertiary hover:bg-state-selected"
            onClick={(event) => onMenu(dashboard, { x: event.clientX, y: event.clientY })}
          >
            <MoreHorizontal className="size-4" />
          </button>
        </div>
      ))}
    </div>
  )
}
