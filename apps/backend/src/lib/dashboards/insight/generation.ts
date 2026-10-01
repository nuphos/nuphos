import { randomUUID } from 'node:crypto'

import { MongoServerError } from 'mongodb'

import { logError } from '@/lib/observability'
import { dashboardPanelInsights, dashboardPanelSnapshots } from '@/models'

import { callModel, FAILURE_MESSAGE } from './model'

import type { InsightFailure, InsightResult } from './model'
import type { DashboardPanel, DashboardPanelInsight, DashboardPanelSnapshot } from '@/models'
import type { ObjectId } from 'mongodb'

const INSIGHT_LEASE_MS = 5 * 60 * 1_000

/** Atomically claim generation for a snapshot. Using the snapshot ObjectId as
 * the insight ObjectId provides one row without another unique index; a
 * generation id fences late model replies from a superseded regeneration. */
export async function createPendingInsight(args: {
  teamId: ObjectId
  panel: DashboardPanel
  snapshot: DashboardPanelSnapshot
  generatedBy: DashboardPanelInsight['generatedBy']
}): Promise<{ insight: DashboardPanelInsight; claimed: boolean }> {
  const { teamId, panel, snapshot, generatedBy } = args
  const now = new Date()
  const existing = await dashboardPanelInsights().findOne({ teamId, snapshotId: snapshot._id })

  if (
    existing?.status === 'pending' &&
    existing.generationLeaseUntil &&
    existing.generationLeaseUntil > now
  ) {
    return { insight: existing, claimed: false }
  }

  const generationId = randomUUID()
  const generationLeaseUntil = new Date(now.getTime() + INSIGHT_LEASE_MS)

  if (!existing) {
    const doc: DashboardPanelInsight = {
      _id: snapshot._id,
      teamId,
      panelId: panel._id,
      snapshotId: snapshot._id,
      scriptVersion: snapshot.scriptVersion,
      generationId,
      generationLeaseUntil,
      status: 'pending',
      findings: [],
      actions: [],
      generatedBy,
      createdAt: now,
      updatedAt: now,
    }

    try {
      await dashboardPanelInsights().insertOne(doc)

      return { insight: doc, claimed: true }
    } catch (err) {
      if (!(err instanceof MongoServerError) || err.code !== 11000) throw err
      const winner = await dashboardPanelInsights().findOne({ teamId, snapshotId: snapshot._id })

      if (!winner) throw err

      return { insight: winner, claimed: false }
    }
  }

  const claimed = await dashboardPanelInsights().findOneAndUpdate(
    { _id: existing._id, teamId, status: existing.status, updatedAt: existing.updatedAt },
    {
      $set: {
        panelId: panel._id,
        scriptVersion: snapshot.scriptVersion,
        generationId,
        generationLeaseUntil,
        status: 'pending',
        findings: [],
        actions: [],
        generatedBy,
        updatedAt: now,
      },
      $unset: { error: '', feedback: '', spawnedConversationId: '' },
    },
    { returnDocument: 'after' },
  )

  if (claimed) return { insight: claimed, claimed: true }
  const winner = await dashboardPanelInsights().findOne({ _id: existing._id, teamId })

  return { insight: winner ?? existing, claimed: false }
}

/** Run the (slow) LLM pass for an already-inserted pending insight and update it
 *  to its terminal state. Never throws — a model failure lands as `failed`. */
export async function runInsightGeneration(args: {
  teamId: ObjectId
  panel: DashboardPanel
  snapshot: DashboardPanelSnapshot
  insightId: ObjectId
  generationId: string
}): Promise<void> {
  const { teamId, panel, snapshot, insightId, generationId } = args
  // Prior run of the SAME request (same script + params / time window) so the
  // "change context" the model sees is a like-for-like delta, not another range.
  const previous = await dashboardPanelSnapshots()
    .find({
      teamId,
      panelId: panel._id,
      status: 'complete',
      codeHash: snapshot.codeHash,
      paramsHash: snapshot.paramsHash,
      _id: { $ne: snapshot._id },
    })
    .sort({ requestedAt: -1 })
    .limit(1)
    .next()

  let outcome: { result: InsightResult } | { failure: InsightFailure }

  try {
    outcome = await callModel(panel, snapshot, previous, {
      teamId: teamId.toHexString(),
      panelId: panel._id.toHexString(),
    })
  } catch (err) {
    logError('dashboard.insight.model_failed', err, {
      panel_id: panel._id.toHexString(),
      snapshot_id: snapshot._id.toHexString(),
    })
    outcome = { failure: 'model_error' }
  }
  const result = 'result' in outcome ? outcome.result : null

  const set: Record<string, unknown> = {
    status: result ? 'complete' : 'failed',
    findings: result?.findings ?? [],
    actions: result?.actions ?? [],
    updatedAt: new Date(),
  }
  const unset: Record<string, ''> = { generationLeaseUntil: '' }

  if (result) unset.error = ''
  else set.error = FAILURE_MESSAGE['failure' in outcome ? outcome.failure : 'model_error']
  const update: Record<string, unknown> = { $set: set, $unset: unset }

  await dashboardPanelInsights().updateOne(
    { _id: insightId, teamId, status: 'pending', generationId },
    update,
  )
}
