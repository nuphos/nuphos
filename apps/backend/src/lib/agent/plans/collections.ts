import { db } from '@/lib/db'
import { logError } from '@/lib/observability'

import type { Plan } from './types'
import type { Collection } from 'mongodb'

const COLLECTION_NAME = 'plans'

export const plans = (): Collection<Plan> => db().collection<Plan>(COLLECTION_NAME)

export async function setupPlanIndexes(): Promise<void> {
  const c = plans()

  try {
    await c.createIndex({ teamId: 1, createdAt: -1 }, { background: true })
    await c.createIndex({ createdBy: 1, createdAt: -1 }, { background: true })
    await c.createIndex({ status: 1, updatedAt: -1 }, { background: true })
    // Lookup-by-number indexes. `number` is the public id, unique per scope
    // (per-team, or per-user for personal plans). Uniqueness is enforced by
    // the counter that numbered them; these indexes just make the scoped lookups fast.
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
