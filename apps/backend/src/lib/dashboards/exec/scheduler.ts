import { randomUUID } from 'node:crypto'

import { config } from '@/config'
import { getTeamMembership } from '@/lib/identity'
import { logError, logEvent } from '@/lib/observability'
import { nuphosDashboards, dashboardPanels, dashboardPanelSnapshots } from '@/models'

import { evaluatePanelAlert } from '../alert-service'
import { generateSnapshotInsight } from '../insight-service'
import { mintDashboardPanelToken } from '../panel-principal'

import { PanelExecError } from './errors'
import { panelExecutionPrincipal } from './params'
import { runOnRuntime } from './runtime-run'
import { selectPanelRuntime } from './runtime-select'

import type { DashboardPanel, DashboardPanelSnapshot } from '@/models'
import type { ObjectId } from 'mongodb'

const RETRY_BACKOFF_MS = 2_000
const EXEC_LEASE_GRACE_MS = 60_000
const PANEL_TOKEN_TTL_SECONDS = Math.ceil(
  (config.dashboards.execTimeoutMs + EXEC_LEASE_GRACE_MS) / 1_000,
)

export function queueSnapshot(snapshotId: ObjectId): void {
  void scheduleSnapshot(snapshotId).catch((err: unknown) => {
    logError('dashboard.panel.exec_schedule_failed', err, { snapshot_id: snapshotId.toHexString() })
    const retry = setTimeout(() => {
      queueSnapshot(snapshotId)
    }, 5_000)

    retry.unref()
  })
}

type Run = {
  snapshot: DashboardPanelSnapshot
  panel: DashboardPanel
  userId: string
  code: string
  /** Held once the first attempt starts; fences a recovered retry from a stale worker. */
  leaseId?: string
}

async function scheduleSnapshot(snapshotId: ObjectId): Promise<void> {
  const snapshot = await dashboardPanelSnapshots().findOne({ _id: snapshotId, status: 'running' })

  if (!snapshot) return
  if (snapshot.leaseUntil && snapshot.leaseUntil.getTime() > Date.now()) {
    requeueAfterLease(snapshot._id, snapshot.leaseUntil)

    return
  }
  const [dashboard, panel] = await Promise.all([
    nuphosDashboards().findOne({ _id: snapshot.dashboardId, teamId: snapshot.teamId }),
    dashboardPanels().findOne({ _id: snapshot.panelId, teamId: snapshot.teamId }),
  ])

  if (!dashboard || !panel) {
    await failSnapshot({ snapshot }, new Error('Panel execution target no longer exists'))

    return
  }
  const version = panel.versions.find((candidate) => candidate.version === snapshot.scriptVersion)

  if (!version || version.codeHash !== snapshot.codeHash) {
    await failSnapshot({ snapshot }, new Error('Panel script version is no longer available'))

    return
  }
  const userId = panelExecutionPrincipal(panel, version.authoredBy)
  const membership = await getTeamMembership(userId, snapshot.teamId.toHexString())
  const canExecute = membership?.role === 'ADMINISTRATOR' || membership?.role === 'EDITOR'

  if (!canExecute) {
    await failSnapshot(
      { snapshot },
      new Error('Panel author is no longer allowed to execute this script'),
    )

    return
  }
  const run: Run = { snapshot, panel, userId, code: version.code }

  try {
    await executeWithRetry(run)
  } catch (err) {
    await failSnapshot(run, err)
  }
}

async function executeWithRetry(run: Run): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      const runtime = await selectPanelRuntime({
        teamId: run.snapshot.teamId.toHexString(),
        panelId: run.panel._id.toHexString(),
      })

      if (!(await holdLease(run))) return
      const nuphosToken = mintDashboardPanelToken({
        userId: run.userId,
        teamId: run.snapshot.teamId.toHexString(),
        panelId: run.panel._id.toHexString(),
        ttlSec: PANEL_TOKEN_TTL_SECONDS,
      })
      const { output, durationMs } = await runOnRuntime({
        runtime,
        jobId: `panel-${run.snapshot._id.toHexString()}-${String(attempt)}`,
        nuphosToken,
        code: run.code,
        params: run.snapshot.params,
        panel: run.panel,
      })

      await completeSnapshot(run, { output, durationMs, runtimeId: runtime.endpoint.runtimeId })

      return
    } catch (err) {
      if (!(err instanceof PanelExecError && err.retryable) || attempt >= 1) throw err
      logEvent('warn', 'dashboard.panel.exec_retry', {
        snapshot_id: run.snapshot._id.toHexString(),
        reason: err.message,
      })
      await Bun.sleep(RETRY_BACKOFF_MS)
    }
  }
}

/** Claim (or renew) the snapshot lease for one attempt. False when another
 * worker holds it; that worker's lease expiry requeues the snapshot. */
async function holdLease(run: Run): Promise<boolean> {
  const now = new Date()
  const leaseUntil = new Date(now.getTime() + config.dashboards.execTimeoutMs + EXEC_LEASE_GRACE_MS)
  const { snapshot } = run

  if (run.leaseId) {
    const renewed = await dashboardPanelSnapshots().updateOne(
      { _id: snapshot._id, teamId: snapshot.teamId, status: 'running', leaseId: run.leaseId },
      { $set: { leaseUntil } },
    )

    return renewed.modifiedCount === 1
  }
  const leaseId = randomUUID()
  const claimed = await dashboardPanelSnapshots().findOneAndUpdate(
    {
      _id: snapshot._id,
      teamId: snapshot.teamId,
      status: 'running',
      $or: [{ leaseUntil: { $exists: false } }, { leaseUntil: { $lte: now } }],
    },
    { $set: { executedAt: now, leaseId, leaseUntil } },
    { returnDocument: 'after' },
  )

  if (claimed) {
    run.leaseId = leaseId
    run.snapshot = claimed

    return true
  }
  const leased = await dashboardPanelSnapshots().findOne(
    { _id: snapshot._id, teamId: snapshot.teamId, status: 'running' },
    { projection: { leaseUntil: 1 } },
  )

  if (leased?.leaseUntil) requeueAfterLease(snapshot._id, leased.leaseUntil)

  return false
}

function requeueAfterLease(snapshotId: ObjectId, leaseUntil: Date): void {
  const timer = setTimeout(
    () => {
      queueSnapshot(snapshotId)
    },
    Math.max(0, leaseUntil.getTime() - Date.now() + 100),
  )

  timer.unref()
}

/** Persist the output, then fire post-complete hooks. */
async function completeSnapshot(
  run: Run,
  result: { output: DashboardPanelSnapshot['output']; durationMs: number; runtimeId?: string },
): Promise<void> {
  const { snapshot, panel } = run
  const teamId = snapshot.teamId
  const executedAt = snapshot.executedAt ?? new Date()
  const finishedAt = new Date()
  const fields = {
    status: 'complete' as const,
    output: result.output,
    durationMs: result.durationMs,
    executedAt,
    finishedAt,
    ...(result.runtimeId ? { runtimeId: result.runtimeId } : {}),
  }
  const persisted = await dashboardPanelSnapshots().findOneAndUpdate(
    { _id: snapshot._id, teamId, status: 'running', leaseId: run.leaseId },
    { $set: fields, $unset: { leaseId: '', leaseUntil: '' } },
    { returnDocument: 'after' },
  )

  if (!persisted) return
  const complete: DashboardPanelSnapshot = persisted

  await evaluatePanelAlert({ teamId, panel, snapshot: complete }).catch((err: unknown) => {
    logError('dashboard.panel.alert_eval_failed', err, { panel_id: panel._id.toHexString() })
  })
  if (snapshot.initialInsightRequested === true) {
    await generateSnapshotInsight({ teamId, panel, snapshot: complete }).catch((err: unknown) => {
      logError('dashboard.panel.eager_insight_failed', err, { panel_id: panel._id.toHexString() })
    })
  }
}

/** Unknown failures stay generic: runtime stderr is never read because panel
 * code controls it and it may carry credentials. PanelExecError messages are
 * backend-authored, bounded diagnostics safe for the desktop error log. */
async function failSnapshot(run: Pick<Run, 'snapshot' | 'leaseId'>, err: unknown): Promise<void> {
  const { snapshot } = run
  const kind = err instanceof PanelExecError ? err.kind : 'internal'

  logError('dashboard.panel.exec_failed', err, {
    panel_id: snapshot.panelId.toHexString(),
    snapshot_id: snapshot._id.toHexString(),
    kind,
  })
  const now = new Date()
  const fence = run.leaseId
    ? { leaseId: run.leaseId }
    : { $or: [{ leaseUntil: { $exists: false } }, { leaseUntil: { $lte: now } }] }

  await dashboardPanelSnapshots().updateOne(
    { _id: snapshot._id, teamId: snapshot.teamId, status: 'running', ...fence },
    {
      $set: {
        status: 'failed',
        error: {
          message: err instanceof PanelExecError ? err.message : 'Panel execution failed',
          kind,
        },
        finishedAt: now,
        ...(snapshot.executedAt ? { executedAt: snapshot.executedAt } : {}),
      },
      $unset: { leaseId: '', leaseUntil: '' },
    },
  )
}

export async function recoverDashboardPanelExecutions(): Promise<void> {
  for await (const snapshot of dashboardPanelSnapshots().find(
    { status: 'running' },
    { projection: { _id: 1 } },
  )) {
    queueSnapshot(snapshot._id)
  }
}
