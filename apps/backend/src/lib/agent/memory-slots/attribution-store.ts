// Runtime-owned attribution store (Track A 1.1): the measurement layer that
// answers "did this memory actually help". Analytics only — NEVER a journal/
// hash-chain row (spec §f); providers never read or write these collections.
import { ObjectId } from 'mongodb'

import { logError, logEvent } from '@/lib/observability'

import {
  agentMemories,
  LIVE_RECORD_FILTER,
  memoryRecordAccessFilter,
  teamMemories,
} from '../memory-native/store'

import { attributionEvents, attributionScores } from './attribution-db'
import { finalizeRetentionScores, foldRetentionRow, MIN_SCORE_TURNS } from './attribution-rollup'

import type { RetentionAccumulator } from './attribution-rollup'

export {
  attributionEvents,
  attributionKey,
  attributionScores,
  attributionTurns,
  deriveTier,
  purgeConversationAttribution,
  recordAttributionSignal,
  recordTurnDistillOutcome,
  setupMemoryAttributionIndexes,
} from './attribution-db'
export { computeRetentionScores, computeTurnScorecard, MIN_SCORE_TURNS } from './attribution-rollup'

// ---------------------------------------------------------------------------
// Retention score rollup (Track A 2.2): fold attribution rows into one score
// per (provider, teamId, lineage) so ranking (2.4) and a scorecard (2.3) can
// read "does this memory actually help" as a number.

const ROLLUP_WINDOW_DAYS = 90
const ROLLUP_INTERVAL_MS = 60 * 60 * 1000

/** lineage per memoryId, resolved AT ROLLUP/READ TIME (capture stores null by
 * design — this is the single place lineage knowledge lives): a playbook's stable
 * lineageId survives revisions; records ARE their own lineage until a
 * supersede-chain collapse is ever needed. Record ids simply miss the playbook
 * lookup and keep themselves. */
export async function resolveLineages(memoryIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()

  for (const id of memoryIds) out.set(id, id)
  const objectIds = [...new Set(memoryIds)]
    .filter((id) => ObjectId.isValid(id))
    .map((id) => new ObjectId(id))

  if (objectIds.length) {
    const playbooks = await teamMemories()
      .find({ _id: { $in: objectIds } }, { projection: { lineageId: 1 } })
      .toArray()

    for (const g of playbooks) out.set(g._id.toHexString(), g.lineageId ?? g._id.toHexString())
  }

  return out
}

/** Full recompute over the trailing window; stale score docs (no window
 * activity) are dropped afterwards. Never cached on any provider doc.
 * Streams the window row-by-row: memory use is bounded by the pool size
 * (distinct lineages + their reach id sets), never by the row count. */
export async function rollupRetentionScores(now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - ROLLUP_WINDOW_DAYS * 24 * 60 * 60 * 1000)
  const filter = { provider: 'native', updatedAt: { $gte: cutoff } }
  // Lineage resolution needs only the distinct memory ids — pool-sized, so
  // distinct()'s 16MB result cap is far out of reach.
  const memoryIds = await attributionEvents().distinct('memoryId', filter)
  const lineages = await resolveLineages(memoryIds)
  const lineageOf = (id: string) => lineages.get(id) ?? id
  const groups = new Map<string, RetentionAccumulator>()
  let rowCount = 0
  const cursor = attributionEvents().find(filter, { projection: { 'signals.note': 0 } })

  for await (const row of cursor) {
    foldRetentionRow(groups, row, lineageOf)
    rowCount += 1
  }
  const scores = finalizeRetentionScores(groups, now)

  if (scores.length) {
    await attributionScores().bulkWrite(
      scores.map((s) => ({
        updateOne: {
          filter: { provider: s.provider, teamId: s.teamId, lineage: s.lineage },
          update: { $set: s },
          upsert: true,
        },
      })),
      { ordered: false },
    )
  }
  await attributionScores().deleteMany({ provider: 'native', computedAt: { $lt: now } })
  logEvent('info', 'memory.retention_rollup.completed', { scores: scores.length, rows: rowCount })

  return scores.length
}

let rollupWarmupTimer: ReturnType<typeof setTimeout> | undefined
let rollupTimer: ReturnType<typeof setInterval> | undefined

/** Plain hourly interval on EVERY replica — the recompute is an
 * idempotent full upsert, so concurrent runs waste work but never corrupt
 * data. Move to a BullMQ repeatable (seal-scheduler pattern) if replica
 * count × window size starts to matter. */
export function initMemoryRetentionRollup(): void {
  const run = () =>
    void rollupRetentionScores().catch((err: unknown) => {
      logError('memory.retention_rollup_failed', err)
    })

  rollupWarmupTimer = setTimeout(run, 30_000) // after boot, not during it
  rollupTimer = setInterval(run, ROLLUP_INTERVAL_MS)
}

export function shutdownMemoryRetentionRollup(): void {
  if (rollupWarmupTimer) clearTimeout(rollupWarmupTimer)
  if (rollupTimer) clearInterval(rollupTimer)
}

// ── Scorecard's two native reads (Phase 2 PR 2) ─────────────────────────────
// GET /memories/scorecard is a runtime-owned analytics surface, but it needs
// two reads against the native stores: the learned-last-7d count and the
// caller-supplied id ownership check. They live here — the grandfathered
// runtime→native touch point — so routes/agent.ts stops importing
// memory-native/store. Filter shapes are the legacy route code, verbatim.

/** Live auto-learned records visible to the caller, created since `since` —
 * the scorecard's learnedLast7d counter. */
export async function countAutoLearnedMemoriesSince(
  userId: string,
  teamId: string | null | undefined,
  since: Date,
): Promise<number> {
  return agentMemories().countDocuments({
    source: 'auto_ingest',
    createdAt: { $gte: since },
    ...memoryRecordAccessFilter(userId, teamId),
    ...LIVE_RECORD_FILTER,
  })
}

/** Ownership check for caller-supplied score ids (already ObjectId-validated
 * by the route): keeps only ids the caller may read — own/team records plus
 * the team's playbooks — preserving the requested order. Without this a
 * teammate could read another user's personal-memory stats from ids seen in
 * shared transcripts. */
export async function filterOwnedMemoryIds(
  userId: string,
  teamId: string | null | undefined,
  memoryIds: string[],
): Promise<string[]> {
  if (memoryIds.length === 0) return []
  const objIds = memoryIds.map((s) => new ObjectId(s))
  const [ownRecords, ownPlaybooks] = await Promise.all([
    agentMemories()
      .find(
        { _id: { $in: objIds }, ...memoryRecordAccessFilter(userId, teamId) },
        { projection: { _id: 1 } },
      )
      .toArray(),
    teamId
      ? teamMemories()
          .find({ _id: { $in: objIds }, teamId }, { projection: { _id: 1 } })
          .toArray()
      : Promise.resolve([]),
  ])
  const allowed = new Set([...ownRecords, ...ownPlaybooks].map((d) => d._id.toHexString()))

  return memoryIds.filter((id) => allowed.has(id))
}

const RECALLED_IDS_TIMEOUT_MS = 500

/** Memories already attached to an earlier turn of this conversation. Fail-open. */
export async function listConversationRecalledIds(
  conversationId: string,
  {
    timeoutMs = RECALLED_IDS_TIMEOUT_MS,
    lookup = () =>
      attributionEvents().distinct(
        'memoryId',
        { conversationId, 'signals.signal': 'recall_log' },
        { maxTimeMS: timeoutMs },
      ),
  }: { timeoutMs?: number; lookup?: () => Promise<unknown[]> } = {},
): Promise<string[]> {
  let timer: ReturnType<typeof setTimeout> | undefined

  try {
    const ids = await Promise.race([
      lookup(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error(`recalled-ids lookup exceeded ${String(timeoutMs)}ms`))
        }, timeoutMs)
      }),
    ])

    return ids.filter((id): id is string => typeof id === 'string')
  } catch (err) {
    logError('memory.recalled_ids_failed', err, { conversationId })

    return []
  } finally {
    clearTimeout(timer)
  }
}

/** Read side of 2.4: memoryId → PROVEN applyRate for ranking. Only lineages
 * with ≥ MIN_SCORE_TURNS observations return a value — everything else is
 * absent, and the caller treats absent as neutral/unproven. Fail-open: any
 * error means an empty map and the lexical order stands. */
export async function fetchRetentionOrderScores(
  teamId: string | null,
  candidates: { memoryId: string }[],
): Promise<Map<string, number>> {
  try {
    const lineageByMemory = await resolveLineages(candidates.map((c) => c.memoryId))
    const scores = await attributionScores()
      .find({
        provider: 'native',
        teamId,
        lineage: { $in: [...new Set(lineageByMemory.values())] },
      })
      .toArray()
    const byLineage = new Map(scores.map((s) => [s.lineage, s]))
    const out = new Map<string, number>()

    for (const [memoryId, lineage] of lineageByMemory) {
      const s = byLineage.get(lineage)

      if (s && s.turns >= MIN_SCORE_TURNS) out.set(memoryId, s.applyRate)
    }

    return out
  } catch (err) {
    logError('memory.retention_order_failed', err, { teamId })

    return new Map()
  }
}
