// Artifact retention. Pinning copies a transfer group's objects under a prefix
// the bucket lifecycle rule does not expire, then moves the records off the
// 24h TTL. Only the artifact reference lifecycle releases them.
import { withTransaction } from '@/lib/db'
import { logError } from '@/lib/observability'
import { getStorageProvider } from '@/lib/storage'
import { fileTransferGroups, fileTransferItems } from '@/models'

import type { StorageProvider } from '@/lib/storage'
import type { FileTransferGroup, FileTransferItem } from '@/models'
import type { ObjectId } from 'mongodb'

/** Pinned objects live where the bucket lifecycle rule must not reach. */
export const PINNED_OBJECT_PREFIX = 'pinned/'

export type PinTransferGroupResult =
  | 'pinned'
  | 'already_pinned'
  | 'not_ready'
  | 'expired'
  | 'missing'

export function pinnedObjectKey(
  teamId: ObjectId,
  groupId: ObjectId,
  itemId: ObjectId,
): string {
  return `${PINNED_OBJECT_PREFIX}${teamId.toHexString()}/${groupId.toHexString()}/${itemId.toHexString()}`
}

async function deleteCopies(
  teamId: ObjectId,
  groupId: ObjectId,
  provider: StorageProvider,
  items: FileTransferItem[],
): Promise<void> {
  for (const item of items) {
    const key = pinnedObjectKey(teamId, groupId, item._id)

    if (key === item.objectKey) continue
    await provider
      .deleteObject({ bucket: item.bucket, region: item.region, key })
      .catch((error: unknown) => {
        logError('file_transfer.pin_rollback_failed', error, { key })
      })
  }
}

/** Copies are unreferenced only while no group record exists to point at them. */
async function discardCopiesIfGroupGone(
  teamId: ObjectId,
  groupId: ObjectId,
  provider: StorageProvider,
  items: FileTransferItem[],
): Promise<void> {
  let group: FileTransferGroup | null = null

  try {
    group = await fileTransferGroups().findOne({ _id: groupId, teamId })
  } catch (error) {
    // The operation that failed matters more than this cleanup attempt.
    logError('file_transfer.pin_rollback_failed', error, {
      team_id: teamId.toHexString(),
      group_id: groupId.toHexString(),
    })

    return
  }

  if (group) return
  await deleteCopies(teamId, groupId, provider, items)
}

export async function pinTransferGroup(
  teamId: ObjectId,
  groupId: ObjectId,
): Promise<PinTransferGroupResult> {
  const group = await fileTransferGroups().findOne({ _id: groupId, teamId })

  if (!group) return 'missing'
  if (group.pinnedAt) return 'already_pinned'
  // Pending/partial/failed groups keep the 24h TTL: not every file is present
  // yet. A later render after finalize records the ref and pins the group then.
  if (group.status !== 'ready') return 'not_ready'
  if (!group.expiresAt) return 'already_pinned'
  if (group.expiresAt.getTime() <= Date.now()) return 'expired'

  const items = (await fileTransferItems().find({ groupId }).toArray()).filter(
    (item) => item.status === 'ready',
  )

  if (items.length === 0) return 'not_ready'
  const provider = getStorageProvider(teamId.toHexString())

  try {
    for (const item of items) {
      const key = pinnedObjectKey(teamId, groupId, item._id)

      if (key === item.objectKey) continue
      await provider.copyObject(
        { bucket: item.bucket, region: item.region, key: item.objectKey },
        key,
      )
    }
  } catch (error) {
    await discardCopiesIfGroupGone(teamId, groupId, provider, items)
    throw error
  }

  let result: PinTransferGroupResult = 'pinned'

  try {
    await withTransaction(async (session) => {
      const now = new Date()
      const pinned = await fileTransferGroups().findOneAndUpdate(
        {
          _id: groupId,
          teamId,
          status: 'ready',
          pinnedAt: { $exists: false },
          // A TTL sweep can delete the group between the load above and this
          // write; the expiry filter also keeps a just-expired group unpinned.
          expiresAt: { $gt: now },
        },
        { $set: { pinnedAt: now }, $unset: { expiresAt: '' } },
        { returnDocument: 'after', session },
      )

      if (!pinned) {
        result = 'missing'
        return
      }
      for (const item of items) {
        await fileTransferItems().updateOne(
          { _id: item._id, groupId, status: 'ready' },
          {
            $set: {
              objectKey: pinnedObjectKey(teamId, groupId, item._id),
              pinnedAt: now,
            },
            $unset: { expiresAt: '' },
          },
          { session },
        )
      }
    })
  } catch (error) {
    await discardCopiesIfGroupGone(teamId, groupId, provider, items)
    throw error
  }

  if (result !== 'pinned') {
    // A concurrent pin may have won, and its records point at these same keys.
    // Re-read rather than trusting the transaction's snapshot.
    const current = await fileTransferGroups().findOne({ _id: groupId, teamId })

    if (current?.pinnedAt) return 'already_pinned'

    const outcome: PinTransferGroupResult = current ? 'expired' : 'missing'

    if (outcome === 'missing') await deleteCopies(teamId, groupId, provider, items)

    return outcome
  }

  // The old transfers/ objects are unreferenced now; the lifecycle rule is the
  // backstop if this best-effort delete fails.
  for (const item of items) {
    const key = pinnedObjectKey(teamId, groupId, item._id)

    if (key === item.objectKey) continue
    await provider
      .deleteObject({ bucket: item.bucket, region: item.region, key: item.objectKey })
      .catch((error: unknown) => {
        logError('file_transfer.pin_cleanup_failed', error, {
          team_id: teamId.toHexString(),
          group_id: groupId.toHexString(),
        })
      })
  }

  return 'pinned'
}