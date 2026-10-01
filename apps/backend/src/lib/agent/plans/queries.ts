import { plans } from './collections'
import { parsePlanNumber, scopedNumberFilter, withTeamScope } from './scope'
import { serializePlan } from './serialize'

import type { PlanScope } from './scope'
import type { PlanDTO } from './serialize'
import type { Plan, PlanLifecycleStatus } from './types'
import type { Filter } from 'mongodb'

export async function getPlan(id: string, scope: PlanScope): Promise<PlanDTO | null> {
  const planNumber = parsePlanNumber(id)

  if (planNumber == null) return null
  const row = await plans().findOne(scopedNumberFilter(planNumber, scope))

  return row ? serializePlan(row) : null
}

/** Internal-only lookup for gateway execution. Never return this object to a client. */
export async function getPlanDocument(id: string, scope: PlanScope): Promise<Plan | null> {
  const planNumber = parsePlanNumber(id)

  if (planNumber == null) return null

  return plans().findOne(scopedNumberFilter(planNumber, scope))
}

export async function listMongoDatabasePlanDocuments(options: {
  teamId: string
  connectionId: string
  limit: number
}): Promise<Plan[]> {
  return plans()
    .find({
      teamId: options.teamId,
      actions: { $elemMatch: { type: 'mongodb.change', connectionId: options.connectionId } },
    })
    .sort({ createdAt: -1 })
    .limit(options.limit)
    .toArray()
}

/**
 * The approved/executing plan currently driving a conversation, if any — the
 * audit journal stamps tool intents with it. Newest first: a conversation
 * re-approving a revised plan attributes to the latest one. The owner scope
 * compounds the filter (defense-in-depth like every other lookup here) so a
 * cross-tenant sessionId collision could never attribute someone else's plan.
 */
export async function findActivePlanForConversation(
  sessionId: string,
  scope: { teamId: string | null; userId: string },
): Promise<{ planNumber: number; approvedBy?: string } | null> {
  const row = await plans().findOne(
    {
      sourceConversationId: sessionId,
      status: { $in: ['approved', 'executing'] },
      ...(scope.teamId ? { teamId: scope.teamId } : { createdBy: scope.userId }),
    },
    { sort: { updatedAt: -1 }, projection: { number: 1, approvedBy: 1 } },
  )

  return row ? { planNumber: row.number, approvedBy: row.approvedBy } : null
}

/**
 * Is this conversation waiting on a human to approve a plan? Same scope rule as
 * every other lookup here. Used on the Slack inbound path, where a thread reply
 * that could BE that approval must not be judged as teammate chatter — so this
 * is a projection-only existence check, cheap enough to run before the
 * addressing judge on every un-mentioned reply.
 */
export async function hasPlanAwaitingApprovalForConversation(
  sessionId: string,
  scope: PlanScope,
): Promise<boolean> {
  const base: Filter<Plan> = {
    sourceConversationId: sessionId,
    status: 'proposed' satisfies PlanLifecycleStatus,
  }
  const query = scope.teamId
    ? { ...base, teamId: scope.teamId }
    : { ...base, createdBy: scope.userId }
  const row = await plans().findOne(query, { projection: { _id: 1 } })

  return Boolean(row)
}

/** The newest plan this conversation proposed since `since` that still awaits approval. */
export async function findProposedPlanNumberForConversation(
  sessionId: string,
  scope: PlanScope,
  since: Date,
): Promise<number | null> {
  const row = await plans().findOne(
    {
      sourceConversationId: sessionId,
      status: 'proposed' satisfies PlanLifecycleStatus,
      updatedAt: { $gte: since },
      ...(scope.teamId ? { teamId: scope.teamId } : { createdBy: scope.userId }),
    },
    { sort: { updatedAt: -1 }, projection: { number: 1 } },
  )

  return row?.number ?? null
}

export async function listPlans(options: {
  teamId?: string
  createdBy?: string
  sourceConversationId?: string
  limit?: number
  cursor?: string
}): Promise<{ plans: PlanDTO[]; nextCursor: string | null; hasMore: boolean }> {
  const limit = options.limit ?? 50
  const base: Record<string, unknown> = {}

  if (options.createdBy) base.createdBy = options.createdBy
  if (options.sourceConversationId) base.sourceConversationId = options.sourceConversationId
  if (options.cursor) {
    // The cursor is a client-supplied query param. A malformed value would
    // become an Invalid Date and make Mongo behave unpredictably, so ignore it
    // (fall back to the first page) rather than emitting a broken filter.
    const cursorDate = new Date(options.cursor)

    if (!Number.isNaN(cursorDate.getTime())) base.createdAt = { $lt: cursorDate }
  }
  const query = withTeamScope(base, options.teamId)
  const rows = await plans()
    .find(query)
    .sort({ createdAt: -1 })
    .limit(limit + 1)
    .toArray()
  const hasMore = rows.length > limit

  if (hasMore) rows.pop()
  const last = rows[rows.length - 1]

  return {
    plans: rows.map(serializePlan),
    nextCursor: hasMore && last ? last.createdAt.toISOString() : null,
    hasMore,
  }
}

/**
 * Non-terminal plans attached to a conversation, oldest first. Powers the
 * per-turn plan-state context block and the end-of-turn stop gate, so it uses
 * the same strict scope rule as scopedNumberFilter (team plans by teamId,
 * personal plans by createdBy — never a loose fallback).
 */
export async function listActivePlansForConversation(
  sessionId: string,
  scope: PlanScope,
): Promise<Plan[]> {
  const base: Record<string, unknown> = {
    sourceConversationId: sessionId,
    status: { $in: ['proposed', 'approved', 'executing'] satisfies PlanLifecycleStatus[] },
  }
  const query = scope.teamId
    ? { ...base, teamId: scope.teamId }
    : { ...base, createdBy: scope.userId }

  return plans().find(query).sort({ createdAt: 1 }).limit(10).toArray()
}

/** Plans created by a native-runtime script during one turn, in card order. */
export async function listPlansCreatedForConversation(
  sessionId: string,
  since: Date,
  scope: PlanScope,
): Promise<PlanDTO[]> {
  const base = { sourceConversationId: sessionId, createdAt: { $gte: since } }
  const query = scope.teamId
    ? { ...base, teamId: scope.teamId }
    : { ...base, createdBy: scope.userId }
  const rows = await plans().find(query).sort({ createdAt: 1 }).limit(10).toArray()

  return rows.map(serializePlan)
}
