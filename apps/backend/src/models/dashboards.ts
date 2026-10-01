import { db } from '@/lib/db'

import type { AgentCredentialAccess } from '@/lib/agent/db'
import type { Collection, ObjectId } from 'mongodb'

// ---------- Dashboards (script-driven live panels) ----------
//
// Grafana-style panels whose data source is a stored JavaScript script.
// Opening a dashboard (or Refresh / new date) re-executes each panel's script on
// one of the team's agent runtimes and writes an immutable snapshot bound to
// (script version, params, exec time). There is NO privileged dashboard-level
// aggregate — "total spend" is a panel like any other. The collections keep
// their original cost_* names. See routes/dashboards.ts and lib/dashboards/*.

export type DashboardTimeRange = {
  periodStart: Date
  periodEnd: Date
  granularity?: 'day' | 'week' | 'month'
}

/** A rolling, relative time window. When set, the concrete `timeRange` is
 *  recomputed (quantized to whole UTC days, so it's stable within a day and
 *  reuses snapshots) on every refresh — scheduled or manual — so a scheduled
 *  dashboard moves forward instead of querying its original window forever. */
export type DashboardRangePreset = 'last7' | 'last14' | 'last30' | 'thisMonth' | 'prevMonth'

export type DashboardRefreshCadence = 'daily' | 'weekly' | 'monthly'

export type NuphosDashboard = {
  _id: ObjectId
  teamId: ObjectId
  name: string
  /** Grafana-style layout: ordered panelIds + grid geometry. No privileged
   *  header — every panel (incl. a "total" panel) is referenced here. */
  layout: { panelId: ObjectId; x: number; y: number; w: number; h: number }[]
  /** The authoritative time range for the whole dashboard. EVERY panel inherits
   *  it — panels never carry their own window (Grafana's time-picker model).
   *  Picking a new date rewrites this and refreshes every panel (new snapshots). */
  timeRange: DashboardTimeRange
  /** When set, `timeRange` is a rolling window derived from this preset and
   *  advanced on each refresh. Absent = a fixed, user-picked custom range. */
  rangePreset?: DashboardRangePreset
  /** Scheduled refresh of every panel; see lib/dashboards/refresh-schedule.ts. */
  cadence?: DashboardRefreshCadence
  /** Set exactly when `cadence` is; the sweeper claims the dashboard once it is due. */
  nextRefreshAt?: Date
  lastScheduledRefreshAt?: Date
  createdBy: string
  createdAt: Date
  updatedAt: Date
}

export const nuphosDashboards = (): Collection<NuphosDashboard> =>
  db().collection<NuphosDashboard>('cost_dashboards')

export type DashboardPanelKind = 'chart' | 'scalar' | 'table'

export type DashboardPanelScriptVersion = {
  /** Monotonic, starts at 1. */
  version: number
  /** The stored JS the runner harness executes (see lib/dashboards). */
  code: string
  /** sha256(code), used to dedupe snapshots and pin a frozen snapshot's script. */
  codeHash: string
  /** 'agent' when authored by the AI build pass, else the userId. */
  authoredBy: string
  createdAt: Date
}

export type DashboardPanel = {
  _id: ObjectId
  teamId: ObjectId
  dashboardId: ObjectId
  title: string
  /** Hints the renderer and validates which output variant the script may emit. */
  kind: DashboardPanelKind
  /** Current head version. */
  scriptVersion: number
  /** Append-only version history (bounded; keep last N). */
  versions: DashboardPanelScriptVersion[]
  /** Extra static params the script reads (provider, accountId, filters…). The
   *  time window is NOT here — it is always inherited from dashboard.timeRange. */
  staticParams?: Record<string, unknown>
  /** Credentials the script may vend. Absent: a new conversation's default,
   *  recomputed from the principal's allow lists on every run. */
  credentialAccess?: AgentCredentialAccess
  createdBy: string
  createdAt: Date
  updatedAt: Date
}

export const dashboardPanels = (): Collection<DashboardPanel> =>
  db().collection<DashboardPanel>('cost_panels')

export type PanelSnapshotStatus = 'running' | 'complete' | 'failed'

export type PanelSnapshotErrorKind =
  | 'timeout'
  | 'oversize'
  | 'nonzero_exit'
  | 'invalid_output'
  | 'runtime_unavailable'
  | 'runtime_outdated'
  /** Read-only: written by the retired sandbox executor. */
  | 'sandbox_expired'
  | 'internal'

/** Validated panel output. The `chart` variant mirrors the desktop
 *  ChartPayload (components/agent/Chart.tsx) verbatim so the renderer's
 *  tryParseChartPayload accepts it unchanged. Canonical schema +
 *  serialization live in lib/dashboards/panel-output.ts. */
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
  _id: ObjectId
  teamId: ObjectId
  dashboardId: ObjectId
  panelId: ObjectId
  /** The exact script identity this ran against — immutable binding. */
  scriptVersion: number
  codeHash: string
  /** Canonical resolved params (dashboard ∪ panel ∪ static) + its hash, so
   *  "same script + same params" is detectable/dedupable. */
  params: Record<string, unknown>
  paramsHash: string
  requestedAt: Date
  executedAt?: Date
  finishedAt?: Date
  status: PanelSnapshotStatus
  /** Internal durable-execution state. A lease is claimed only when a local
   *  concurrency slot starts; expired leases are safe to recover after restart. */
  leaseId?: string
  leaseUntil?: Date
  /** Only panel creation requests an eager first insight. */
  initialInsightRequested?: boolean
  /** Ad-hoc view queries do not evaluate shared alert rules. */
  viewOnly?: boolean
  output?: DashboardPanelOutput
  error?: { message: string; kind: PanelSnapshotErrorKind }
  runtimeId?: string
  /** Read-only: written by the retired sandbox executor. */
  sandboxId?: string
  durationMs?: number
  /** Per-document TTL: set to createdAt + retention at insert; every snapshot
   *  ages out after the billing-retention window. Drives the TTL index. */
  expiresAt: Date
  createdAt: Date
}

export const dashboardPanelSnapshots = (): Collection<DashboardPanelSnapshot> =>
  db().collection<DashboardPanelSnapshot>('cost_panel_snapshots')

export type PanelInsightAction = {
  title: string
  detail: string
  /** Seed prompt handed to Agent Chat when the user runs the action. Must
   *  request a plan/confirmation (guarded like v1 tools-cost-analysis). */
  prompt: string
  risk: 'low' | 'medium' | 'high'
  estimatedImpactUsd?: number
}

export type DashboardPanelInsight = {
  _id: ObjectId
  teamId: ObjectId
  panelId: ObjectId
  /** The snapshot this insight interprets (immutable evidence binding). */
  snapshotId: ObjectId
  scriptVersion: number
  /** Fences late model replies from a superseded regeneration. */
  generationId: string
  generationLeaseUntil?: Date
  status: 'pending' | 'complete' | 'failed'
  findings: {
    title: string
    detail: string
    kind: 'insight' | 'anomaly' | 'driver' | 'hypothesis'
    confidence: 'high' | 'medium' | 'low'
    evidence?: string
  }[]
  actions: PanelInsightAction[]
  feedback?: { rating: 'up' | 'down'; note?: string; by: string; at: Date }
  /** The Agent Chat conversation spawned by "run first action", if any. */
  spawnedConversationId?: string
  generatedBy: 'eager-create' | 'manual-regenerate'
  error?: string
  createdAt: Date
  updatedAt: Date
}

export const dashboardPanelInsights = (): Collection<DashboardPanelInsight> =>
  db().collection<DashboardPanelInsight>('cost_panel_insights')

export type DashboardPanelAlertChannel =
  | { type: 'slack'; channelId: string }
  | { type: 'discord'; webhookUrl: string }
  | { type: 'email'; to: string[] }

export type DashboardPanelAlert = {
  _id: ObjectId
  teamId: ObjectId
  panelId: ObjectId
  enabled: boolean
  /** Which numeric the rule reads out of the snapshot output. For a scalar
   *  panel it's output.value; for chart/table, a named series/column reducer. */
  metric: { extract: 'scalar' | 'series-last' | 'series-sum' | 'column-sum'; ref?: string }
  condition: { op: 'gt' | 'gte' | 'lt' | 'increase_pct'; threshold: number }
  channels: DashboardPanelAlertChannel[]
  /** `lastSnapshotAt` is the `requestedAt` of the snapshot this state was
   *  derived from. Evaluations are fenced on it so a slow older run that
   *  finishes after a newer one can't overwrite the state or notify on data
   *  that has already been superseded. */
  state?: { breached: boolean; lastValue?: number; lastEvaluatedAt: Date; lastSnapshotAt?: Date }
  createdAt: Date
  updatedAt: Date
}

export const dashboardPanelAlerts = (): Collection<DashboardPanelAlert> =>
  db().collection<DashboardPanelAlert>('cost_panel_alerts')
