import { GridFSBucket } from 'mongodb'

import { db } from '@/lib/db'
import { logError } from '@/lib/observability'

import type { ObjectId } from 'mongodb'

export async function cleanupExpiredBotImports() {
  const collection = db().collection<{ _id: string; fileId: ObjectId; stagedRemoved?: boolean }>(
    'agent_bot_imports',
  )
  const expired = await collection
    .find({
      expiresAt: { $lte: new Date() },
      stagedRemoved: { $ne: true },
      $or: [{ leaseUntil: { $exists: false } }, { leaseUntil: { $lt: new Date() } }],
    })
    .limit(20)
    .toArray()
  const bucket = new GridFSBucket(db(), { bucketName: 'agent_bot_import_files' })

  for (const batch of expired) {
    // Claim this exact expired file before deletion; a renewed stage uses a different file ID.
    const claimed = await collection.updateOne(
      {
        _id: batch._id,
        fileId: batch.fileId,
        expiresAt: { $lte: new Date() },
        stagedRemoved: { $ne: true },
      },
      { $set: { stagedRemoved: true } },
    )

    if (!claimed.matchedCount) continue
    try {
      await bucket.delete(batch.fileId)
    } catch (error) {
      await collection.updateOne(
        { _id: batch._id, fileId: batch.fileId },
        { $unset: { stagedRemoved: '' } },
      )
      throw error
    }
  }
}

export function startBotImportCleanup() {
  let running = false
  const sweep = async () => {
    if (running) return
    running = true
    try {
      await cleanupExpiredBotImports()
    } catch (error) {
      logError('agent.bot_import.cleanup_failed', error)
    } finally {
      running = false
    }
  }
  const timer = setInterval(() => void sweep(), 60_000)

  timer.unref()
  void sweep()

  return () => {
    clearInterval(timer)
  }
}
