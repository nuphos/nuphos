import { db } from '@/lib/db'
import { sha256Hex } from '@/lib/journal/hashing'
import { redactSecrets } from '@/lib/journal/redact'

import type {
  AttributionSignal,
  AttributionSignalEntry,
  AttributionTier,
  MemoryAttributionEvent,
  MemoryRetentionScore,
  MemoryScope,
  MemoryTurnSummary,
  TurnDistillOutcome,
} from './attribution-types'
import type { Collection } from 'mongodb'

const ATTRIBUTIONS = 'memory_runtime_attributions'
const TURNS = 'memory_runtime_turns'
const SCORES = 'memory_runtime_scores'

export const attributionEvents = (): Collection<MemoryAttributionEvent> =>
  db().collection(ATTRIBUTIONS)
export const attributionTurns = (): Collection<MemoryTurnSummary> => db().collection(TURNS)
export const attributionScores = (): Collection<MemoryRetentionScore> => db().collection(SCORES)

export function attributionKey(
  provider: string,
  conversationId: string,
  turnKey: string,
  memoryId: string,
): string {
  return sha256Hex(`${provider}|${conversationId}|${turnKey}|${memoryId}`)
}

/** Tier precedence (A4③): human > supersede > judge > fetch > recall. */
export function deriveTier(signals: AttributionSignalEntry[]): AttributionTier {
  const find = (s: AttributionSignal) => signals.find((x) => x.signal === s)
  const human = find('human_feedback')

  if (human?.verdict) return human.verdict
  if (find('supersede_correction')) return 'not_applicable'
  const judge = find('attribution_judge')

  if (judge?.verdict) return judge.verdict
  if (find('fetch_log')) return 'fetched'
  if (find('recall_log')) return 'recalled'

  return 'recalled'
}

// Read-modify-write, not $push. Per-turn per-memory contention is
// effectively nil (one writer per signal type per turn); the sha256 key makes
// it idempotent. Move to an aggregation-pipeline update only if contention shows.
export async function recordAttributionSignal(input: {
  provider: string
  teamId: string | null
  userId: string
  conversationId: string
  turnKey: string
  memoryId: string
  lineage: string | null
  scope: MemoryScope
  signal: AttributionSignalEntry
}): Promise<void> {
  const key = attributionKey(input.provider, input.conversationId, input.turnKey, input.memoryId)
  const now = new Date()
  const note = input.signal.note
    ? redactSecrets(input.signal.note).redacted.slice(0, 300)
    : undefined
  const entry: AttributionSignalEntry = { ...input.signal, at: now, ...(note ? { note } : {}) }

  if (!note) delete entry.note
  const existing = await attributionEvents().findOne({ key })
  // Dedup by signal type: a retried recall/judge REPLACES, never appends.
  const signals = [...(existing?.signals ?? []).filter((s) => s.signal !== entry.signal), entry]

  await attributionEvents().updateOne(
    { key },
    {
      $set: { tier: deriveTier(signals), signals, updatedAt: now },
      $setOnInsert: {
        key,
        v: 1,
        provider: input.provider,
        teamId: input.teamId,
        userId: input.userId,
        conversationId: input.conversationId,
        turnKey: input.turnKey,
        memoryId: input.memoryId,
        lineage: input.lineage,
        scope: input.scope,
        createdAt: now,
      },
    },
    { upsert: true },
  )
}

/** Distiller outcome onto the turn row (mirrors the judge's updates). Plain
 * update, no upsert: capture already wrote the row earlier in the same
 * fire-and-forget chain, defaulting distill to 'skipped_disabled'. */
export async function recordTurnDistillOutcome(
  conversationId: string,
  turnKey: string,
  distill: TurnDistillOutcome,
): Promise<void> {
  await attributionTurns().updateOne({ conversationId, turnKey }, { $set: { distill } })
}

/** A6 erasure — called from deleteConversation. Scores are lineage-keyed and
 * periodically recomputed, so they need no per-conversation purge. */
export async function purgeConversationAttribution(conversationId: string): Promise<void> {
  await Promise.all([
    attributionEvents().deleteMany({ conversationId }),
    attributionTurns().deleteMany({ conversationId }),
  ])
}

// Turn summaries age out: they only feed 90d health stats (scorecard,
// zero-recall rate) and carry no per-memory association. Attribution rows
// have NO TTL on purpose — they ARE the permanent "this memory was used in
// that conversation at this time" record (per-signal timestamps included),
// removed only when their conversation is deleted.
const TURNS_TTL_SECONDS = 120 * 24 * 60 * 60

export async function setupMemoryAttributionIndexes(): Promise<void> {
  await attributionEvents().createIndex({ key: 1 }, { unique: true })
  await attributionEvents().createIndex({ provider: 1, teamId: 1, lineage: 1 })
  await attributionEvents().createIndex({ conversationId: 1 })
  // Rollup window scan (2.2).
  await attributionEvents().createIndex({ provider: 1, updatedAt: -1 })
  await attributionTurns().createIndex({ conversationId: 1, turnKey: 1 }, { unique: true })
  // Scorecard window reads (2.3): filter is `at` + one of userId/teamId.
  await attributionTurns().createIndex({ teamId: 1, at: -1 })
  await attributionTurns().createIndex({ userId: 1, at: -1 })
  await attributionTurns().createIndex({ at: 1 }, { expireAfterSeconds: TURNS_TTL_SECONDS })
  await attributionScores().createIndex({ provider: 1, teamId: 1, lineage: 1 }, { unique: true })
}
