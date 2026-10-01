// Dashboards domain types — mirror the backend serialization in
// apps/backend/src/routes/dashboards.ts. Dashboards are Grafana-style
// blank canvases; every panel is a stored JS script that re-executes on one of
// the team's agent runtimes and yields an immutable snapshot.

import type { AgentCredentialSelection } from '../api/agent-credential-types'
import type { DashboardCadence } from './view/cadence'

// Opens the right-side "Ask your infrastructure." agent rail with a seed
// prompt. Mirrors the callback threaded through the desktop views.
export type OpenAgentChat = (
  prompt: string,
  options?: { send?: boolean; background?: boolean },
) => void

export type DashboardGranularity = 'day' | 'week' | 'month'
export type DashboardRangePreset = 'last7' | 'last14' | 'last30' | 'thisMonth' | 'prevMonth'
export type DashboardViewRange =
  | { preset: DashboardRangePreset }
  | { periodStart: string; periodEnd: string; granularity?: DashboardGranularity }

export type DashboardPanelKind = 'chart' | 'scalar' | 'table'
export type PanelSnapshotStatus = 'running' | 'complete' | 'failed'
export type PanelSnapshotErrorKind =
  | 'timeout'
  | 'oversize'
  | 'nonzero_exit'
  | 'invalid_output'
  | 'runtime_unavailable'
  | 'runtime_outdated'
  // Only on snapshots from the retired sandbox executor.
  | 'sandbox_expired'
  | 'internal'

// Validated panel output. The `chart` variant is ChartPayload-shaped so it feeds
// straight into components/agent/Chart.tsx via tryParseChartPayload.
export type DashboardPanelOutput =
  | {
      kind: 'chart'
      type: 'area' | 'bar' | 'line'
      title: string
      description?: string
      xKey: string
      series: { key: string; label?: string }[]
      data: Record<string, string | number | null>[]
      stacked?: boolean
    }
  | {
      kind: 'scalar'
      title: string
      value: number
      unit: 'usd' | 'count' | 'percent'
      deltaPct?: number
      sublabel?: string
    }
  | {
      kind: 'table'
      title: string
      columns: { key: string; label?: string; numeric?: boolean }[]
      rows: Record<string, string | number | null>[]
    }

export type DashboardPanelSnapshot = {
  id: string
  panelId: string
  dashboardId: string
  scriptVersion: number
  codeHash: string
  params: Record<string, unknown>
  paramsHash: string
  requestedAt: string
  executedAt: string | null
  finishedAt: string | null
  status: PanelSnapshotStatus
  output: DashboardPanelOutput | null
  error: { message: string; kind: PanelSnapshotErrorKind } | null
  runtimeId: string | null
  sandboxId: string | null
  durationMs: number | null
  createdAt: string
}

export type PanelFinding = {
  title: string
  detail: string
  kind: 'insight' | 'anomaly' | 'driver' | 'hypothesis'
  confidence: 'high' | 'medium' | 'low'
  evidence?: string
}

export type PanelInsightAction = {
  title: string
  detail: string
  prompt: string
  risk: 'low' | 'medium' | 'high'
  estimatedImpactUsd?: number
}

export type DashboardPanelInsight = {
  id: string
  panelId: string
  snapshotId: string
  scriptVersion: number
  status: 'pending' | 'complete' | 'failed'
  findings: PanelFinding[]
  actions: PanelInsightAction[]
  feedback: { rating: 'up' | 'down'; note: string | null } | null
  generatedBy: 'eager-create' | 'manual-regenerate'
  error: string | null
  createdAt: string
  updatedAt: string
}

export type DashboardPanelVersionMeta = {
  version: number
  codeHash: string
  authoredBy: string
  createdAt: string
}

export type DashboardPanel = {
  id: string
  dashboardId: string
  title: string
  kind: DashboardPanelKind
  scriptVersion: number
  code: string
  versions: DashboardPanelVersionMeta[]
  staticParams: Record<string, unknown> | null
  // null: the panel uses what a new conversation starts with.
  credentialAccess: AgentCredentialSelection | null
  currentSnapshot: DashboardPanelSnapshot | null
  lastSuccessfulSnapshot: DashboardPanelSnapshot | null
  insight: DashboardPanelInsight | null
  insightStale: boolean
  createdBy: string
  createdAt: string
  updatedAt: string
}

export type NuphosDashboardLayoutItem = {
  panelId: string
  x: number
  y: number
  w: number
  h: number
}

export type NuphosDashboard = {
  id: string
  teamId: string
  name: string
  layout: NuphosDashboardLayoutItem[]
  // Saved default / scheduled range. Browsing uses request-local view parameters.
  timeRange: { periodStart: string; periodEnd: string; granularity: DashboardGranularity | null }
  // When set, the range rolls: the server recomputes + advances it on refresh.
  rangePreset: DashboardRangePreset | null
  cadence: DashboardCadence | null
  nextRefreshAt: string | null
  lastScheduledRefreshAt: string | null
  createdBy: string
  createdAt: string
  updatedAt: string
}

export type NuphosDashboardDetail = {
  canEdit?: boolean
  dashboard: NuphosDashboard
  viewTimeRange?: NuphosDashboard['timeRange']
  panels: DashboardPanel[]
}

// ---- Alerts ----

export type PanelAlertExtract = 'scalar' | 'series-last' | 'series-sum' | 'column-sum'
export type PanelAlertOp = 'gt' | 'gte' | 'lt' | 'increase_pct'
export type DashboardPanelAlertChannel =
  | { type: 'slack'; channelId: string }
  | { type: 'discord'; webhookUrl: string }
  | { type: 'email'; to: string[] }

export type DashboardPanelAlertInput = {
  enabled: boolean
  metric: { extract: PanelAlertExtract; ref?: string }
  condition: { op: PanelAlertOp; threshold: number }
  channels: DashboardPanelAlertChannel[]
}

export type DashboardPanelAlert = DashboardPanelAlertInput & {
  id: string
  panelId: string
  state: { breached: boolean; lastValue: number | null; lastEvaluatedAt: string } | null
  createdAt: string
  updatedAt: string
}

// ---- Request payloads ----

export type DashboardTimeRangeInput = {
  periodStart: string
  periodEnd: string
  granularity?: DashboardGranularity
}

export type CreateDashboardInput = {
  name: string
  timeRange: DashboardTimeRangeInput
  rangePreset?: DashboardRangePreset
}

export type UpdateDashboardInput = {
  name?: string
  timeRange?: DashboardTimeRangeInput
  // A preset makes the range roll; null switches back to the fixed timeRange.
  rangePreset?: DashboardRangePreset | null
  layout?: NuphosDashboardLayoutItem[]
  cadence?: DashboardCadence | null
}

export type CreatePanelInput = {
  title: string
  kind: DashboardPanelKind
  code: string
  staticParams?: Record<string, unknown>
  credentialAccess?: AgentCredentialSelection
}

export type UpdatePanelInput = {
  title?: string
  kind?: DashboardPanelKind
  code?: string
  staticParams?: Record<string, unknown> | null
  credentialAccess?: AgentCredentialSelection | null
}
