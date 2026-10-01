// Runtime-owned measurement schema. NEVER imported by any provider adapter
// (spec §c). provider is stamped 'native' for all Track A rows.
import type { TeamMemoryApplicationAction } from '../memory-native/types'
import type { ObjectId } from 'mongodb'

export type MemoryScope = 'personal' | 'team'

/** Derived tier a memory reached this turn. Judge owns applied|considered;
 * recalled/fetched are free-signal floors (spec §a, A4③). */
export type AttributionTier = 'recalled' | 'fetched' | 'considered' | 'applied' | 'not_applicable'

export type AttributionSignal =
  | 'recall_log' // runtime captured render() output ids
  | 'fetch_log' // runtime observer.fetched
  | 'attribution_judge' // post-hoc LLM judge
  | 'supersede_correction' // runtime-observed supersede (negative)
  | 'human_feedback' // authoritative override (verdict pre-mapped by caller)

export type AttributionSignalEntry = {
  signal: AttributionSignal
  at: Date
  verdict?: TeamMemoryApplicationAction // judge / mapped human verdict
  note?: string // ≤300 chars, redactSecrets()-passed
}

/** One row per (provider, conversationId, turnKey, memoryId). */
export type MemoryAttributionEvent = {
  _id?: ObjectId
  v: 1
  key: string // sha256(provider|conversationId|turnKey|memoryId)
  provider: string // 'native' for all Track A rows
  teamId: string | null
  userId: string
  conversationId: string
  turnKey: string
  memoryId: string
  lineage: string | null
  scope: MemoryScope
  tier: AttributionTier // DERIVED — recomputed on every signal write
  signals: AttributionSignalEntry[]
  createdAt: Date
  updatedAt: Date
}

/** Why the turn's recall produced what it produced. `recalledCount: 0` alone
 * cannot distinguish "searched and matched nothing" from "never searched" —
 * the distinction this field exists to make durable. */
export type TurnRecallOutcome =
  | 'matched' // search ran, >=1 entry survived the score floor
  | 'no_match' // search ran fine and legally found nothing
  | 'empty_query' // no searchable text (edge/system-only turn)
  | 'failed' // recall raced out or threw; fail-open ate the error
  | 'not_planned' // recall deliberately skipped (approval/permission resume)

/** Distiller decision this turn (mirrors `judge`). This is the denominator
 * that makes auto-ingest measurable: without it, learn=false turns are
 * silent and the distiller's skip/yield rates cannot be computed at all. */
export type TurnDistillOutcome =
  | 'saved' // learned and a record was created
  | 'deduped' // learned but an identical live record already existed (textHash)
  | 'rejected' // learned but createMemoryRecord refused (secret gate etc.)
  | 'no_learn' // model decided nothing durable was taught (expected common case)
  | 'skipped_short' // combined query+answer under the length gate
  | 'skipped_volatile' // learned, but classified as knowledge that goes stale
  | 'skipped_origin' // non-user origin: durable writes are user-origin only
  | 'skipped_plan_approval' // the turn was a surface-generated plan approval
  | 'skipped_disabled' // MEMORY_AUTO_INGEST off
  | 'failed' // distiller model error/timeout

/** One row per (conversationId, turnKey). deliveryMode lives here (A4⑤):
 * attribution rows reach it by joining on (conversationId, turnKey). */
export type MemoryTurnSummary = {
  _id?: ObjectId
  provider: string
  teamId: string | null
  userId: string
  conversationId: string
  turnKey: string
  deliveryMode: string // config.agent.memoryDeliveryMode at capture time
  recalledCount: number
  recallOutcome?: TurnRecallOutcome
  fetchedCount: number
  judge:
    | 'ran'
    | 'skipped_zero_candidates'
    | 'skipped_disabled'
    | 'skipped_sampled'
    | 'failed'
    | 'pending'
  appliedCount: number
  distill: TurnDistillOutcome
  at: Date
}

/** Rollup (Phase 2 fills it), unique {provider, teamId, lineage}. */
export type MemoryRetentionScore = {
  _id?: ObjectId
  provider: string
  teamId: string | null
  lineage: string
  /** Denominator: turns this lineage appeared in during the window — also the
   * min-n gate for treating applyRate as signal rather than noise. */
  turns: number
  applied: number
  considered: number
  notApplicable: number
  applyRate: number
  reachConversations: number
  reachUsers: number
  corrections: number
  lastAppliedAt: Date | null
  computedAt: Date
}
