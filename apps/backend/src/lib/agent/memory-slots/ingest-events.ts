// Runtime-owned durable IngestOutcome snapshots (memory_runtime_ingest_events,
// under the reserved 'runtime' prefix like the attribution collections).
// Providers resolve ingest AFTER the SSE stream closes; the frame is
// best-effort, this snapshot is the durable record — it is what lets
// GET /memories/ingest/:sessionId serve learned events post-hoc for EVERY
// provider without a listIngestEvents method on the SPI (types.ts NOTE).
// Analytics/read-model only — never a journal/hash-chain row; providers never
// read or write this collection (same stance as attribution-store).

import { db } from '@/lib/db'

import type { IngestOutcome, MemorySavedEvent } from './types'
import type { Collection, ObjectId } from 'mongodb'

const INGEST_EVENTS = 'memory_runtime_ingest_events'

/** One row per (conversationId, turnKey) — a retried/late-settling ingest
 * REPLACES its snapshot (pending → completed), never appends a duplicate. */
export type MemoryIngestEventSnapshot = {
  _id?: ObjectId
  v: 1
  provider: string
  teamId: string | null
  userId: string
  conversationId: string
  turnKey: string
  status: 'completed' | 'pending'
  saved: MemorySavedEvent[]
  diagnostics?: Record<string, number | string | boolean>
  at: Date
}

export const ingestEventSnapshots = (): Collection<MemoryIngestEventSnapshot> =>
  db().collection(INGEST_EVENTS)

export async function recordIngestEventSnapshot(input: {
  provider: string
  teamId: string | null
  userId: string
  conversationId: string
  turnKey: string
  outcome: IngestOutcome
}): Promise<void> {
  const now = new Date()

  await ingestEventSnapshots().updateOne(
    { conversationId: input.conversationId, turnKey: input.turnKey },
    {
      $set: {
        // SPI: absent status means 'completed' — normalize at write time so
        // the read side never re-derives it.
        status: input.outcome.status ?? 'completed',
        saved: input.outcome.saved,
        ...(input.outcome.diagnostics ? { diagnostics: input.outcome.diagnostics } : {}),
        at: now,
      },
      // A replace IS a replace: a late-settling retry without diagnostics
      // must not inherit the pending snapshot's stale ones.
      ...(input.outcome.diagnostics ? {} : { $unset: { diagnostics: '' } }),
      $setOnInsert: {
        v: 1,
        provider: input.provider,
        teamId: input.teamId,
        userId: input.userId,
        conversationId: input.conversationId,
        turnKey: input.turnKey,
      },
    },
    { upsert: true },
  )
}

/** One row per turn, so this bound is turns-per-conversation — far above any
 * real session, but a hard stop for a pathological one. */
const LIST_SNAPSHOT_CAP = 500

/** Read side for GET /memories/ingest/:sessionId. Oldest first: the desktop
 * replays learned chips in turn order. */
export async function listIngestEventSnapshots(
  conversationId: string,
): Promise<MemoryIngestEventSnapshot[]> {
  return ingestEventSnapshots()
    .find({ conversationId })
    .sort({ at: 1 })
    .limit(LIST_SNAPSHOT_CAP)
    .toArray()
}

/** Exact-turn read used while a client waits for asynchronous ingest. */
export async function getIngestEventSnapshot(
  conversationId: string,
  turnKey: string,
): Promise<MemoryIngestEventSnapshot | null> {
  return ingestEventSnapshots().findOne({ conversationId, turnKey })
}

/** A6 erasure — same join as purgeConversationAttribution. */
export async function purgeConversationIngestEvents(conversationId: string): Promise<void> {
  await ingestEventSnapshots().deleteMany({ conversationId })
}

export async function setupMemoryIngestEventIndexes(): Promise<void> {
  // Unique turn key doubles as the session-prefix read index for the route
  // and the purge join.
  await ingestEventSnapshots().createIndex({ conversationId: 1, turnKey: 1 }, { unique: true })
}
