import { db } from '@/lib/db'
import { logError } from '@/lib/observability'

import type { Plan } from './types'
import type { Collection } from 'mongodb'

const COLLECTION_NAME = 'plans'

export const plans = (): Collection<Plan> => db().collection<Plan>(COLLECTION_NAME)

// Atomic per-scope counter for the GitHub-PR-style plan number. One doc per
// scope key (`team:<id>` or `user:<id>`); `findOneAndUpdate` with `$inc` +
// upsert hands out a unique increasing seq even under concurrent creates.
type PlanCounter = {
  _id: string
  seq: number
}

const planCounters = (): Collection<PlanCounter> => db().collection<PlanCounter>('plan_counters')

type TeamPlanApprovalPolicy = {
  _id: string
  requesterApprovalRequired: boolean
  minimumOtherApprovals: number
  version: number
  updatedAt: Date
  updatedBy: string
}

export const planApprovalPolicies = (): Collection<TeamPlanApprovalPolicy> =>
  db().collection<TeamPlanApprovalPolicy>('plan_approval_policies')

export function planCounterScope(opts: { teamId?: string; createdBy: string }): string {
  return opts.teamId ? `team:${opts.teamId}` : `user:${opts.createdBy}`
}

export async function nextPlanNumber(scope: string): Promise<number> {
  const res = await planCounters().findOneAndUpdate(
    { _id: scope },
    { $inc: { seq: 1 } },
    { upsert: true, returnDocument: 'after' },
  )

  return res?.seq ?? 1
}

export async function setupPlanIndexes(): Promise<void> {
  const c = plans()

  try {
    await c.createIndex({ teamId: 1, createdAt: -1 }, { background: true })
    await c.createIndex({ createdBy: 1, createdAt: -1 }, { background: true })
    await c.createIndex({ status: 1, updatedAt: -1 }, { background: true })
    // Lookup-by-number indexes. `number` is the public id, unique per scope
    // (per-team, or per-user for personal plans). Uniqueness is enforced by
    // the atomic counter; these indexes just make the scoped lookups fast.
    await c.createIndex({ teamId: 1, number: 1 }, { background: true })
    await c.createIndex({ createdBy: 1, number: 1 }, { background: true })
    // listActivePlansForConversation runs on every agent turn. Equality on
    // sourceConversationId is highly selective (a conversation carries at
    // most a handful of plans), so one compound index with the sort key
    // serves both scope variants (teamId / createdBy) without a scan.
    await c.createIndex({ sourceConversationId: 1, createdAt: 1 }, { background: true })
    await c.createIndex(
      { teamId: 1, 'actions.type': 1, 'actions.connectionId': 1, createdAt: -1 },
      { background: true },
    )
  } catch (err) {
    logError('agent.plan.indexes_create_failed', err)
  }
}
