// Full Access, per conversation: when the switch is on, the runtime's permission
// requests are allowed without asking (see openab-permission-bridge). A Task
// under a Bot has no switch of its own and runs in the mode of its topmost
// parent, the conversation its credentials come from. The collection keeps its
// original name; it once also held per-command grants.
import { credentialSourceOf } from '@/lib/agent/db/credential-source'
import { db } from '@/lib/db'
import { AppError } from '@/lib/errors'
import { logError } from '@/lib/observability'

import type { Collection, ObjectId } from 'mongodb'

export async function setupAutoModeIndexes(): Promise<void> {
  try {
    await authorizations().createIndex(
      { conversationId: 1, userId: 1 },
      { unique: true, background: true },
    )
    // The switch lives as long as its conversation. A TTL on updatedAt used to
    // delete it a week after it was set, however active the conversation was.
    try {
      await authorizations().dropIndex('updatedAt_1')
    } catch (err) {
      if ((err as { codeName?: string }).codeName !== 'IndexNotFound') throw err
    }
  } catch (err) {
    logError('agent.auto_mode.indexes_create_failed', err)
  }
}

type AutoModeAuthorizationsDoc = {
  _id?: ObjectId
  conversationId: string
  userId: string
  bypass?: boolean
  createdAt: Date
  updatedAt: Date
}

const AUTHORIZATIONS_COLLECTION = 'auto_mode_authorizations'
const authorizations = (): Collection<AutoModeAuthorizationsDoc> =>
  db().collection<AutoModeAuthorizationsDoc>(AUTHORIZATIONS_COLLECTION)

/** The conversation whose switch `conversationId` runs under: itself unless it is a Task under a Bot. */
async function modeSource(conversationId: string): Promise<string> {
  return (await credentialSourceOf(conversationId))?.sessionId ?? conversationId
}

/** First-turn preference: never overwrite an explicit toggle or a retry's state. */
export async function initializeSessionBypass(
  conversationId: string,
  userId: string,
  enabled: boolean,
): Promise<void> {
  if ((await modeSource(conversationId)) !== conversationId) return
  const now = new Date()

  await authorizations().updateOne(
    { conversationId, userId },
    {
      $setOnInsert: {
        conversationId,
        userId,
        createdAt: now,
        updatedAt: now,
        bypass: enabled,
      },
    },
    { upsert: true },
  )
}

export async function setSessionBypass(
  conversationId: string,
  userId: string,
  enabled: boolean,
): Promise<void> {
  if ((await modeSource(conversationId)) !== conversationId) {
    throw new AppError(
      409,
      'mode_follows_bot',
      "A Task under a Bot runs in its Bot's permission mode. Change the mode on the Bot.",
    )
  }
  const now = new Date()

  await authorizations().updateOne(
    { conversationId, userId },
    {
      $setOnInsert: { conversationId, userId, createdAt: now },
      $set: { bypass: enabled, updatedAt: now },
    },
    { upsert: true },
  )
}

export async function getSessionBypass(conversationId: string, userId: string): Promise<boolean> {
  const doc = await authorizations().findOne(
    { conversationId: await modeSource(conversationId), userId },
    { projection: { bypass: 1 } },
  )

  return doc?.bypass === true
}
