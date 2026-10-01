import type { Tone } from '../../lib/workloadStatus'
import type { ContainerUsageRow } from '../../types'

// A clickable status breakdown segment. `filter` (e.g. "status=Running"), when
// present, deep-links to the resource list pre-filtered to that phase.
export type Segment = { label: string; count: number; tone: Tone; filter?: string }

export type OverviewCard = {
  key: string
  title: string
  // Clicking the card title navigates here (unfiltered). null = not navigable.
  navKey: string | null
  // null means this resource failed to load (rendered as unavailable).
  total: number | null
  // Empty → render the plain total count; otherwise render the breakdown.
  segments: Segment[]
}

// Cluster-level resource totals, aggregated across nodes. `total` is the summed
// node allocatable; `used`/`request` are summed actuals (null when no node
// reported the metric, e.g. metrics-server unavailable).
export type Meter = { used: number | null; total: number | null }

export type ResourceSummary = {
  cpuUsage: Meter
  cpuRequest: Meter
  memUsage: Meter
  memRequest: Meter
  pods: Meter
}

// Recent activity rows. The lists are null when their source failed to load
// (rendered "Unavailable"), an empty array when nothing recent (the Aptakube
// "nothing in the last hour" message), or populated.
export type WarningItem = {
  key: string
  reason: string
  object: string
  message: string
  iso: string | null
}

export type RestartItem = {
  key: string
  namespace: string
  name: string
  restarts: number
  iso: string | null
}

// The page's data is split in two so the first paint isn't gated on the
// slowest requests: `core` (the resource LISTs behind the cards/usage/restarts)
// renders as soon as it lands, while `extras` (warning events + per-container
// metrics — typically the heaviest calls) fill their panels in afterwards.
export type OverviewCore = {
  cards: OverviewCard[]
  resources: ResourceSummary | null
  restarts: RestartItem[] | null
}

export type OverviewExtras = {
  warnings: WarningItem[] | null
  // null = per-container usage couldn't be computed (metrics-server absent).
  abnormal: ContainerUsageRow[] | null
}

export const RECENT_WINDOW_MS = 60 * 60 * 1000 // "last hour", matching Aptakube
export const RECENT_LIMIT = 8

export function isRecent(iso: string | null): boolean {
  if (!iso) return false
  const t = new Date(iso).getTime()

  return Number.isFinite(t) && t >= Date.now() - RECENT_WINDOW_MS
}

// "% of Limit" thresholds for the High / Abnormal Usage table, matching
// Aptakube. The backend caps and pre-sorts the rows; the dropdown filters
// client-side so changing it doesn't re-fetch.
export const ABNORMAL_THRESHOLDS = [70, 80, 90, 100]
export const DEFAULT_ABNORMAL_THRESHOLD = 80
