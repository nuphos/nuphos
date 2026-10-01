import { ObjectId } from 'mongodb'

import { db } from '@/lib/db'
import { logError } from '@/lib/observability'

import type { Collection, Filter } from 'mongodb'

export const LOCAL_RUNTIME_ACTIVITY_RETENTION_DAYS = 90

/** One conversation this computer served, rolled up across its turns. */
export type LocalRuntimeSessionEntry = {
  _id?: ObjectId
  ownerUserId: string
  deviceId: string
  teamId: string
  sessionId: string
  lastActorUserId: string
  firstServedAt: Date
  lastServedAt: Date
  turns: number
}

const sessions = (): Collection<LocalRuntimeSessionEntry> =>
  db().collection<LocalRuntimeSessionEntry>('agent_device_runtime_sessions')

export async function setupLocalRuntimeActivityIndexes(): Promise<void> {
  const collection = sessions()

  await collection.createIndex(
    { ownerUserId: 1, deviceId: 1, sessionId: 1 },
    { unique: true, name: 'device_runtime_session_unique' },
  )
  await collection.createIndex(
    { ownerUserId: 1, deviceId: 1, lastServedAt: -1, _id: -1 },
    { name: 'device_runtime_session_recent' },
  )
  await collection.createIndex(
    { lastServedAt: 1 },
    {
      name: 'device_runtime_session_ttl',
      expireAfterSeconds: LOCAL_RUNTIME_ACTIVITY_RETENTION_DAYS * 24 * 60 * 60,
    },
  )
}

export type LocalRuntimeTurn = {
  ownerUserId: string
  deviceId: string
  teamId: string
  sessionId: string
  actorUserId: string
  at?: Date
}

/** Best effort: a failed write must never fail the turn it describes. */
export async function recordLocalRuntimeTurn(turn: LocalRuntimeTurn): Promise<void> {
  const at = turn.at ?? new Date()

  try {
    await sessions().updateOne(
      { ownerUserId: turn.ownerUserId, deviceId: turn.deviceId, sessionId: turn.sessionId },
      {
        $set: { teamId: turn.teamId, lastActorUserId: turn.actorUserId, lastServedAt: at },
        $setOnInsert: { firstServedAt: at },
        $inc: { turns: 1 },
      },
      { upsert: true },
    )
  } catch (err) {
    logError('agent.local_runtime.activity_write_failed', err, {
      deviceId: turn.deviceId,
      sessionId: turn.sessionId,
    })
  }
}

export type LocalRuntimeActivityPage = {
  entries: LocalRuntimeSessionEntry[]
  nextCursor: string | null
}

export function decodeActivityCursor(cursor: string): { at: Date; id: ObjectId } | null {
  const [iso, id] = cursor.split('_')
  const at = new Date(iso ?? '')

  if (!id || !ObjectId.isValid(id) || Number.isNaN(at.getTime())) return null

  return { at, id: new ObjectId(id) }
}

export async function listLocalRuntimeActivity(
  ownerUserId: string,
  deviceId: string,
  options: { limit: number; cursor?: string },
): Promise<LocalRuntimeActivityPage> {
  const cursor = options.cursor ? decodeActivityCursor(options.cursor) : null
  const filter: Filter<LocalRuntimeSessionEntry> = {
    ownerUserId,
    deviceId,
    ...(cursor
      ? {
          $or: [
            { lastServedAt: { $lt: cursor.at } },
            { lastServedAt: cursor.at, _id: { $lt: cursor.id } },
          ],
        }
      : {}),
  }
  const docs = await sessions()
    .find(filter)
    .sort({ lastServedAt: -1, _id: -1 })
    .limit(options.limit + 1)
    .toArray()
  const entries = docs.slice(0, options.limit)
  const last = entries.at(-1)

  return {
    entries,
    nextCursor:
      docs.length > options.limit && last?._id
        ? `${last.lastServedAt.toISOString()}_${last._id.toHexString()}`
        : null,
  }
}
