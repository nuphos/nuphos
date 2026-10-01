import { MongoServerError, ObjectId } from 'mongodb'

import { config } from '@/config'
import { dashboardPanels, dashboardPanelSnapshots } from '@/models'

import { advanceRelativeWindow, headCode, resolveParams } from './params'
import { queueSnapshot } from './scheduler'

import type { NuphosDashboard, DashboardPanel, DashboardPanelSnapshot } from '@/models'

// ---------------------------------------------------------------------------
// Single-panel execution
// ---------------------------------------------------------------------------

export type ExecuteArgs = {
  teamId: ObjectId
  dashboard: NuphosDashboard
  panel: DashboardPanel
  /** Bypass completed-snapshot reuse. An equivalent in-flight run is still
   * reused so duplicate clicks cannot execute the same script concurrently. */
  force?: boolean
  /** Generate the panel's initial insight after its first successful run. */
  generateInsight?: boolean
  viewOnly?: boolean
}

/**
 * Execute one panel's script on a team runtime and persist an
 * immutable snapshot. Returns the resulting (or reused) snapshot document.
 * Never throws for script/exec failures — those land in a `failed` snapshot.
 */
export async function executePanel(args: ExecuteArgs): Promise<DashboardPanelSnapshot> {
  const { teamId, panel, force, generateInsight = false } = args
  const dashboard = await advanceRelativeWindow(args.dashboard)
  const { codeHash, version } = headCode(panel)
  const { params, paramsHash } = resolveParams(dashboard, panel)
  const now = new Date()

  // Reuse the immutable snapshot for identical (script version, params) — a
  // snapshot is bound to (codeHash, paramsHash), and params carry the concrete
  // time window, so the same range + same script deterministically maps to the
  // same result. Opening the dashboard or switching to an already-computed time
  // range reuses the stored snapshot; only an explicit force (manual Refresh or
  // a cadence run) re-executes to pull fresher billing data. `snapshotFreshMs`
  // is an optional max-age cap on reuse (0 = reuse indefinitely, the default).
  if (!force) {
    const existing = await dashboardPanelSnapshots()
      .find({
        teamId,
        panelId: panel._id,
        codeHash,
        paramsHash,
        status: { $in: ['running', 'complete'] },
      })
      .sort({ requestedAt: -1 })
      .limit(1)
      .next()

    if (existing) {
      if (existing.status === 'running') return reuseRunning(existing, args.viewOnly)
      const cap = config.dashboards.snapshotFreshMs

      if (cap <= 0 || now.getTime() - existing.requestedAt.getTime() < cap) return existing
    }
  }

  const snapshot: DashboardPanelSnapshot = {
    _id: new ObjectId(),
    teamId,
    dashboardId: dashboard._id,
    panelId: panel._id,
    scriptVersion: version,
    codeHash,
    params,
    paramsHash,
    requestedAt: now,
    status: 'running',
    viewOnly: args.viewOnly === true,
    ...(generateInsight ? { initialInsightRequested: true } : {}),
    // Per-doc TTL = billing retention.
    expiresAt: new Date(now.getTime() + config.dashboards.snapshotTtlDays * 24 * 60 * 60 * 1000),
    createdAt: now,
  }

  try {
    await dashboardPanelSnapshots().insertOne(snapshot)
  } catch (err) {
    if (!(err instanceof MongoServerError) || err.code !== 11000) throw err
    const running = await dashboardPanelSnapshots().findOne({
      teamId,
      panelId: panel._id,
      codeHash,
      paramsHash,
      status: 'running',
    })

    if (!running) throw err

    return reuseRunning(running, args.viewOnly)
  }

  // The snapshot itself is the durable job record. Queue it locally for low
  // latency; startup recovery requeues any row left running after a restart.
  queueSnapshot(snapshot._id)

  return snapshot
}

// ---------------------------------------------------------------------------
// Dashboard-wide refresh
// ---------------------------------------------------------------------------

/** Start a run for every panel and return their (running) snapshots
 *  immediately. Each panel runs in the background; a failing panel never
 *  blocks the others.
 *  The client polls each snapshot to completion. */
export async function refreshDashboard(args: {
  teamId: ObjectId
  dashboard: NuphosDashboard
  force?: boolean
  viewOnly?: boolean
}): Promise<DashboardPanelSnapshot[]> {
  const { teamId, force } = args
  // Advance a rolling range to today before running, so scheduled/manual refresh
  // never keeps querying a stale fixed window.
  const dashboard = await advanceRelativeWindow(args.dashboard)
  const panels = await dashboardPanels().find({ teamId, dashboardId: dashboard._id }).toArray()

  return Promise.all(
    panels.map((panel) =>
      executePanel({ teamId, dashboard, panel, force, viewOnly: args.viewOnly }),
    ),
  )
}

/** A scheduled/default refresh may join a viewer's identical in-flight query.
 * Promote that run so its completion still evaluates the shared alert. */
async function reuseRunning(
  snapshot: DashboardPanelSnapshot,
  viewOnly?: boolean,
): Promise<DashboardPanelSnapshot> {
  if (!viewOnly && snapshot.viewOnly) {
    await dashboardPanelSnapshots().updateOne(
      { _id: snapshot._id, status: 'running' },
      { $set: { viewOnly: false } },
    )
  }

  return snapshot
}
