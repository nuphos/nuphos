// Durable join between conversation-scoped MCP requests and one Claude Code
// chat turn. The live bridge updates the hosting accumulator immediately; this
// store is the cross-replica/race-safe source the finalizer merges before it
// snapshots provenance and attribution.
import { db } from '@/lib/db'

import type { TurnMemoryAccumulator } from './turn-accumulator'
import type { MemoryFetchedEvent, MemorySavedEvent } from './types'
import type { Collection, ObjectId } from 'mongodb'

const PREVIEW_MEMORY_ACTIVITY = 'memory_runtime_preview_activity'

type PreviewMemoryActivity = {
  _id?: ObjectId
  conversationId: string
  turnKey: string
  activity: 'fetched' | 'saved'
  memoryId: string
  event: MemoryFetchedEvent | MemorySavedEvent
  at: Date
}

const activities = (): Collection<PreviewMemoryActivity> => db().collection(PREVIEW_MEMORY_ACTIVITY)

export async function recordPreviewMemoryActivity(
  conversationId: string,
  turnKey: string,
  activity: 'fetched' | 'saved',
  event: MemoryFetchedEvent | MemorySavedEvent,
): Promise<void> {
  await activities().updateOne(
    { conversationId, turnKey, activity, memoryId: event.id },
    { $set: { event, at: new Date() } },
    { upsert: true },
  )
}

export async function mergePreviewMemoryActivity(
  accumulator: TurnMemoryAccumulator,
  conversationId: string,
  turnKey: string,
): Promise<void> {
  const rows = await activities().find({ conversationId, turnKey }).sort({ at: 1 }).toArray()

  for (const row of rows) {
    if (row.activity === 'fetched') accumulator.observer.fetched(row.event as MemoryFetchedEvent)
    else accumulator.noteSaved(row.event as MemorySavedEvent)
  }
}

export async function purgeConversationPreviewMemoryActivity(
  conversationId: string,
): Promise<void> {
  await activities().deleteMany({ conversationId })
}

export async function setupPreviewMemoryActivityIndexes(): Promise<void> {
  await activities().createIndex(
    { conversationId: 1, turnKey: 1, activity: 1, memoryId: 1 },
    { unique: true },
  )
  await activities().createIndex({ at: 1 }, { expireAfterSeconds: 7 * 24 * 60 * 60 })
}
