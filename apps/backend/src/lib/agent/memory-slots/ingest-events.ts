// Runtime-owned snapshots of what post-turn auto-ingest learned
// (memory_runtime_ingest_events, under the reserved 'runtime' prefix like the
// attribution collections). Auto-ingest is gone — the agent saves memory
// itself — so nothing writes here anymore; the rows that exist still back
// GET /memories/ingest/:sessionId for the learned chips of older
// conversations, and are erased with their conversation.

import { db } from '@/lib/db'

import type { MemorySavedEvent } from './types'
import type { Collection, ObjectId } from 'mongodb'

const INGEST_EVENTS = 'memory_runtime_ingest_events'

/** One row per (conversationId, turnKey). */
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

/** Exact-turn read (a persisted chip carries its turn key). */
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
