import { randomUUID } from 'node:crypto'

import { MongoServerError } from 'mongodb'

import { db } from '@/lib/db'
import { AppError } from '@/lib/errors'

import type { Collection } from 'mongodb'

/** Longer than any write here takes; a crashed holder frees the vault after it. */
const LOCK_MS = 30_000

const locks = (): Collection<{ _id: string; token: string; until: Date }> =>
  db().collection('vault_locks')

/**
 * Runs one write of a user's vault at a time. Every write reads the device set
 * or the item names and then writes against it, so two at once could leave an
 * item without a key for an enrolled device.
 */
export async function exclusive<T>(userId: string, body: () => Promise<T>): Promise<T> {
  const token = randomUUID()
  const now = new Date()

  try {
    // Matches only an expired lock; a held one makes the upsert collide on _id.
    await locks().updateOne(
      { _id: userId, until: { $lt: now } },
      { $set: { token, until: new Date(now.getTime() + LOCK_MS) } },
      { upsert: true },
    )
  } catch (error) {
    if (error instanceof MongoServerError && error.code === 11000) {
      throw new AppError(409, 'vault_busy', 'Another change to this vault is in progress; retry')
    }
    throw error
  }
  try {
    return await body()
  } finally {
    await locks().deleteOne({ _id: userId, token })
  }
}
