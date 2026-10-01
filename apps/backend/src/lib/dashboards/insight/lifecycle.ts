import { logError } from '@/lib/observability'
import { dashboardPanelInsights, dashboardPanels, dashboardPanelSnapshots } from '@/models'

import { createPendingInsight, runInsightGeneration } from './generation'

import type { DashboardPanel, DashboardPanelInsight, DashboardPanelSnapshot } from '@/models'
import type { ObjectId } from 'mongodb'

function queueInsightRecovery(insightId: ObjectId, leaseUntil: Date): void {
  const delay = Math.max(0, leaseUntil.getTime() - Date.now() + 100)
  const timer = setTimeout(() => {
    void recoverInsightGeneration(insightId).catch((err: unknown) => {
      logError('dashboard.insight.recovery_failed', err, { insight_id: insightId.toHexString() })
    })
  }, delay)

  timer.unref()
}

function launchInsightGeneration(args: {
  teamId: ObjectId
  panel: DashboardPanel
  snapshot: DashboardPanelSnapshot
  insight: DashboardPanelInsight
}): void {
  const { teamId, panel, snapshot, insight } = args

  queueInsightRecovery(insight._id, insight.generationLeaseUntil ?? new Date(0))
  void runInsightGeneration({
    teamId,
    panel,
    snapshot,
    insightId: insight._id,
    generationId: insight.generationId,
  }).catch((err: unknown) => {
    logError('dashboard.insight.background_failed', err, {
      panel_id: panel._id.toHexString(),
      insight_id: insight._id.toHexString(),
    })
  })
}

async function recoverInsightGeneration(insightId: ObjectId): Promise<void> {
  const insight = await dashboardPanelInsights().findOne({ _id: insightId, status: 'pending' })

  if (!insight) return
  if (insight.generationLeaseUntil && insight.generationLeaseUntil > new Date()) {
    queueInsightRecovery(insight._id, insight.generationLeaseUntil)

    return
  }
  const [panel, snapshot] = await Promise.all([
    dashboardPanels().findOne({ _id: insight.panelId, teamId: insight.teamId }),
    dashboardPanelSnapshots().findOne({ _id: insight.snapshotId, teamId: insight.teamId }),
  ])

  if (!panel || snapshot?.status !== 'complete' || !snapshot.output) {
    await dashboardPanelInsights().updateOne(
      {
        _id: insight._id,
        teamId: insight.teamId,
        status: 'pending',
        generationId: insight.generationId,
      },
      {
        $set: {
          status: 'failed',
          error: 'Insight generation was interrupted and its source snapshot is unavailable.',
          updatedAt: new Date(),
        },
        $unset: { generationLeaseUntil: '' },
      },
    )

    return
  }
  const pending = await createPendingInsight({
    teamId: insight.teamId,
    panel,
    snapshot,
    generatedBy: insight.generatedBy,
  })

  if (pending.claimed)
    launchInsightGeneration({ teamId: insight.teamId, panel, snapshot, insight: pending.insight })
  else if (pending.insight.status === 'pending') {
    queueInsightRecovery(pending.insight._id, pending.insight.generationLeaseUntil ?? new Date(0))
  }
}

/** Requeue pending generations after a process restart. CAS + generation leases
 * make this safe when multiple backend replicas recover the same row. */
export async function recoverDashboardPanelInsights(): Promise<void> {
  for await (const insight of dashboardPanelInsights().find({ status: 'pending' })) {
    queueInsightRecovery(insight._id, insight.generationLeaseUntil ?? new Date(0))
  }
}

/**
 * Start insight generation asynchronously: insert a `pending` insight, kick off
 * the model pass in the background, and return the pending doc immediately. Use
 * this on the request path so a slow LLM call never times out the HTTP request —
 * the client polls until the insight reaches `complete`/`failed`.
 */
export async function startInsightGeneration(args: {
  teamId: ObjectId
  panel: DashboardPanel
  snapshot: DashboardPanelSnapshot
  generatedBy: DashboardPanelInsight['generatedBy']
}): Promise<DashboardPanelInsight | null> {
  const { teamId, panel, snapshot, generatedBy } = args

  if (snapshot.status !== 'complete' || !snapshot.output) return null
  const pending = await createPendingInsight({ teamId, panel, snapshot, generatedBy })

  if (pending.claimed) {
    launchInsightGeneration({ teamId, panel, snapshot, insight: pending.insight })
  }

  return pending.insight
}

/** Generate the initial Insight for a newly-created panel. Refreshes deliberately
 * skip this path: they update data only and leave the previous insight stale
 * until the user explicitly regenerates it. */
export async function generateSnapshotInsight(args: {
  teamId: ObjectId
  panel: DashboardPanel
  snapshot: DashboardPanelSnapshot
}): Promise<void> {
  const { teamId, panel, snapshot } = args

  if (snapshot.status !== 'complete') return
  await startInsightGeneration({ teamId, panel, snapshot, generatedBy: 'eager-create' }).catch(
    (err: unknown) => {
      logError('dashboard.insight.eager_failed', err, { panel_id: panel._id.toHexString() })
    },
  )
}

/** The insight to show for a panel: the one bound to its current snapshot
 *  (insights travel with snapshots), falling back to the newest — marked stale —
 *  when the current snapshot has none of its own. */
export async function getLatestInsight(
  teamId: ObjectId,
  panel: DashboardPanel,
  currentSnapshotId: ObjectId | null,
): Promise<{ insight: DashboardPanelInsight | null; stale: boolean }> {
  if (currentSnapshotId) {
    const bound = await dashboardPanelInsights().findOne({
      teamId,
      panelId: panel._id,
      snapshotId: currentSnapshotId,
    })

    if (bound) return { insight: bound, stale: false }
  }
  const insight = await dashboardPanelInsights()
    .find({ teamId, panelId: panel._id })
    .sort({ createdAt: -1 })
    .limit(1)
    .next()

  return { insight, stale: Boolean(insight) }
}
