import { api } from '../../api'

import type {
  NuphosDashboard,
  NuphosDashboardDetail,
  DashboardPanel,
  DashboardRangePreset,
} from '../schema'

export function defaultRange(): { periodStart: string; periodEnd: string } {
  const end = new Date()
  const start = new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000)

  return { periodStart: start.toISOString(), periodEnd: end.toISOString() }
}

/** Create a dashboard with the standard naming and default range. */
export function createNuphosDashboard(
  teamId: string,
  hasExisting: boolean,
): Promise<NuphosDashboard> {
  const name = hasExisting ? 'New dashboard' : 'Overview'

  return api.dashboardsCreate(teamId, {
    name,
    timeRange: defaultRange(),
    rangePreset: 'last30',
  })
}

export const RANGE_PRESETS: { key: DashboardRangePreset; label: string }[] = [
  { key: 'last7', label: 'Last 7 days' },
  { key: 'last14', label: 'Last 14 days' },
  { key: 'last30', label: 'Last 30 days' },
  { key: 'thisMonth', label: 'This month' },
  { key: 'prevMonth', label: 'Previous month' },
]

/** A short human label for the active range, e.g. "Jun 17 – Jul 17". */
export function rangeLabel(periodStart: string, periodEnd: string): string {
  const fmt = (s: string) =>
    new Date(s).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' })

  return `${fmt(periodStart)} – ${fmt(periodEnd)}`
}

export function latestCompletedRefreshAt(detail: NuphosDashboardDetail | null): string | null {
  let latest: string | null = null

  for (const panel of detail?.panels ?? []) {
    const snapshot = panel.lastSuccessfulSnapshot ?? panel.currentSnapshot

    if (snapshot?.status !== 'complete') continue
    const completedAt = snapshot.finishedAt ?? snapshot.requestedAt

    if (!latest || completedAt > latest) latest = completedAt
  }

  return latest
}

export function refreshAge(timestamp: string): string {
  const elapsedSeconds = Math.max(
    0,
    Math.floor((Date.now() - new Date(timestamp).getTime()) / 1_000),
  )

  if (elapsedSeconds < 60) return 'just now'
  const elapsedMinutes = Math.floor(elapsedSeconds / 60)

  if (elapsedMinutes < 60) return `${String(elapsedMinutes)}m ago`
  const elapsedHours = Math.floor(elapsedMinutes / 60)

  if (elapsedHours < 24) return `${String(elapsedHours)}h ago`

  return new Date(timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

/** Order panels by the dashboard's layout array (fallback: creation order). */
export function orderPanels(detail: NuphosDashboardDetail): DashboardPanel[] {
  const index = new Map(detail.dashboard.layout.map((l, i) => [l.panelId, i]))

  return [...detail.panels].sort((a, b) => (index.get(a.id) ?? 999) - (index.get(b.id) ?? 999))
}
