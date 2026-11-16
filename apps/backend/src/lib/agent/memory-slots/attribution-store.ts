// Runtime-owned attribution store (Track A 1.1): the measurement layer that
// answers "did this memory actually help". Analytics only — NEVER a journal/
// hash-chain row (spec §f); providers never read or write these collections.
import { ObjectId } from 'mongodb'

import { logError, logEvent } from '@/lib/observability'
import { claimRun } from '@/lib/redis'

import {
  agentMemories,
  LIVE_RECORD_FILTER,
  memoryRecordAccessFilter,
  teamMemories,
} from '../memory-native/store'

import { attributionEvents, attributionScores } from './attribution-db'
import { retentionScorePipeline } from './attribution-pipeline'
import { MIN_SCORE_TURNS } from './attribution-rollup'

import type { MemoryRetentionScore } from './attribution-types'

export {
  attributionEvents,
  attributionKey,
  attributionScores,
  attributionTurns,
  deriveTier,
  purgeConversationAttribution,
  recordAttributionSignal,
  setupMemoryAttributionIndexes,
} from './attribution-db'
export { computeRetentionScores, computeTurnScorecard, MIN_SCORE_TURNS } from './attribution-rollup'

// ---------------------------------------------------------------------------
// Retention score rollup (Track A 2.2): fold attribution rows into one score
// per (provider, teamId, lineage) so ranking (2.4) and a scorecard (2.3) can
// read "does this memory actually help" as a number.

const ROLLUP_WINDOW_DAYS = 90
const SCORE_CHUNK = 500
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

/** Upserts one chunk of scores. Chunked so no single write serializes them all. */
async function writeScores(scores: MemoryRetentionScore[]): Promise<void> {
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

/** Full recompute over the trailing window. The database folds the rows into
 * one score per lineage, so the backend only reads the scores and writes them
 * back in chunks; it no longer decodes every row in the window, which held its
 * event loop for most of a second. Stale score docs (no window activity) are
 * dropped afterwards. */
export async function rollupRetentionScores(now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - ROLLUP_WINDOW_DAYS * 24 * 60 * 60 * 1000)
  const filter = { provider: 'native', updatedAt: { $gte: cutoff } }
  const cursor = attributionEvents().aggregate<MemoryRetentionScore>(
    retentionScorePipeline(filter, teamMemories().collectionName, now),
    { allowDiskUse: true, batchSize: SCORE_CHUNK },
  )
  let chunk: MemoryRetentionScore[] = []
  let scores = 0

  for await (const score of cursor) {
    chunk.push(score)
    if (chunk.length < SCORE_CHUNK) continue
    await writeScores(chunk)
    scores += chunk.length
    chunk = []
  }
  if (chunk.length) await writeScores(chunk)
  scores += chunk.length
  await attributionScores().deleteMany({ provider: 'native', computedAt: { $lt: now } })
  logEvent('info', 'memory.retention_rollup.completed', { scores })

  return scores
}

let rollupWarmupTimer: ReturnType<typeof setTimeout> | undefined
let rollupTimer: ReturnType<typeof setInterval> | undefined

/** The hourly recompute, on one replica: every replica ticks, the first to
 * claim the hour runs it. The claim lasts a little under the interval, so the
 * next hour can be claimed again. */
export async function rollupOnOneReplica(): Promise<void> {
  if (await claimRun('memory:retention-rollup', ROLLUP_INTERVAL_MS - 5 * 60 * 1000))
    await rollupRetentionScores()
}

export function initMemoryRetentionRollup(): void {
  const run = () =>
    void rollupOnOneReplica().catch((err: unknown) => {
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
