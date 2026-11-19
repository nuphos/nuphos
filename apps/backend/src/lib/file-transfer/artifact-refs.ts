// Which transfer groups an artifact shows, and their retention. A markdown
// artifact cites a group through `/_reply-images/<groupId>`; citing it records
// a ref and pins the group so the media outlives the 24h transfer TTL.
import { MongoServerError, ObjectId } from 'mongodb'

import { withTransaction } from '@/lib/db'
import { logError } from '@/lib/observability'
import { getStorageProvider } from '@/lib/storage'
import { fileTransferGroups, fileTransferItems, fileTransferRefs } from '@/models'

import { PINNED_OBJECT_PREFIX, pinTransferGroup } from './pinning'

const REPLY_IMAGE_REFERENCE = /\/_reply-images\/([a-f0-9]{24})(?![a-f0-9])/g

/** Every distinct group id a markdown body cites through `_reply-images`. */
export function extractReplyImageGroupIds(content: string): string[] {
  const ids = new Set<string>()

  for (const match of content.matchAll(REPLY_IMAGE_REFERENCE)) {
    const id = match[1]

    if (id && ObjectId.isValid(id)) ids.add(id)
  }

  return [...ids]
}

export type ArtifactReferenceInput = {
  teamId: string
  sessionId: string
  artifactId: string
  content: string
}

/**
 * Record one ref per cited group and pin the group. Bad or foreign group ids
 * are ignored; a database or storage failure is logged per group and never
 * fails the artifact render that triggered it.
 */
export async function recordArtifactFileRefs(input: ArtifactReferenceInput): Promise<void> {
  const groupIds = extractReplyImageGroupIds(input.content)

  if (groupIds.length === 0 || !ObjectId.isValid(input.teamId)) return
  const teamId = new ObjectId(input.teamId)

  for (const groupId of groupIds) {
    try {
      // Same scope and expiry rule as loadGroup, but a miss is ignored rather
      // than thrown: the artifact still renders.
      const group = await fileTransferGroups().findOne({ _id: new ObjectId(groupId), teamId })

      if (!group) continue
      if (group.expiresAt && group.expiresAt.getTime() <= Date.now() && !group.pinnedAt) continue

      const added = await addFileTransferRef(teamId, group._id, input)

      if (added === 'missing') continue
      await pinTransferGroup(teamId, group._id)
    } catch (error) {
      logError('file_transfer.artifact_ref_failed', error, {
        team_id: input.teamId,
        session_id: input.sessionId,
        artifact_id: input.artifactId,
        group_id: groupId,
      })
    }
  }
}

async function addFileTransferRef(
  teamId: ObjectId,
  groupId: ObjectId,
  input: ArtifactReferenceInput,
): Promise<'added' | 'exists' | 'missing'> {
  let result: 'added' | 'exists' | 'missing' = 'missing'

  try {
    await withTransaction(async (session) => {
      // Increment first so a group deleted concurrently makes this a no-op and
      // rolls the ref back, instead of leaving a ref for a missing group.
      const group = await fileTransferGroups().updateOne(
        { _id: groupId, teamId },
        { $inc: { refCount: 1 } },
        { session },
      )

      if (group.matchedCount === 0) return

      const ref = await fileTransferRefs().updateOne(
        { groupId, sessionId: input.sessionId, artifactId: input.artifactId },
        {
          $setOnInsert: {
            teamId,
            groupId,
            sessionId: input.sessionId,
            artifactId: input.artifactId,
            createdAt: new Date(),
          },
        },
        { upsert: true, session },
      )

      if (ref.upsertedCount === 0) {
        // This artifact already cites the group; undo the provisional count.
        await fileTransferGroups().updateOne(
          { _id: groupId },
          { $inc: { refCount: -1 } },
          { session },
        )
        result = 'exists'
        return
      }
      result = 'added'
    })
  } catch (error) {
    // Two concurrent first renders race on the unique ref index; the winner
    // already counted the ref.
    if (error instanceof MongoServerError && error.code === 11000) return 'exists'
    throw error
  }

  return result
}

/** The last ref is gone, so the group and its pinned objects go too. */
export async function purgeConversationFileTransferRefs(sessionId: string): Promise<void> {
  const refs = await fileTransferRefs().find({ sessionId }).toArray()

  if (refs.length === 0) return
  const groupIds = new Map<string, ObjectId>()

  for (const ref of refs) groupIds.set(ref.groupId.toHexString(), ref.groupId)
  let failure: unknown

  for (const groupId of groupIds.values()) {
    try {
      await releaseGroup(groupId, sessionId)
    } catch (error) {
      // Try every group, then fail the purge so the operator reruns it.
      failure ??= error
      logError('file_transfer.artifact_release_failed', error, {
        session_id: sessionId,
        group_id: groupId.toHexString(),
      })
    }
  }

  if (failure !== undefined) throw failure
}

class ConcurrentRefAddedError extends Error {}

async function releaseGroup(groupId: ObjectId, sessionId: string): Promise<void> {
  // Read first: the rows carry the pinned keys to delete after the commit.
  const items = await fileTransferItems().find({ groupId }).toArray()
  const pinned = items.filter((item) => item.objectKey.startsWith(PINNED_OBJECT_PREFIX))
  let released = false

  try {
    await withTransaction(async (session) => {
      const deleted = await fileTransferRefs().deleteMany({ groupId, sessionId }, { session })

      if (deleted.deletedCount === 0) return
      const group = await fileTransferGroups().findOneAndUpdate(
        { _id: groupId },
        { $inc: { refCount: -deleted.deletedCount } },
        { returnDocument: 'after', session },
      )

      if (!group) {
        // The group was already removed; only its rows can be left behind.
        await fileTransferItems().deleteMany({ groupId }, { session })
        released = true
        return
      }
      if ((group.refCount ?? 0) > 0) return
      await fileTransferItems().deleteMany({ groupId }, { session })
      // The same transaction owns the decrement, so a ref added concurrently
      // conflicts and retries; this guard is the last line of defence.
      const removed = await fileTransferGroups().deleteOne(
        { _id: groupId, refCount: { $lte: 0 } },
        { session },
      )

      if (removed.deletedCount === 0) throw new ConcurrentRefAddedError()
      released = true
    })
  } catch (error) {
    if (error instanceof ConcurrentRefAddedError) return
    throw error
  }

  const first = pinned[0]

  if (!released || !first) return
  let provider: ReturnType<typeof getStorageProvider>

  try {
    provider = getStorageProvider(first.teamId.toHexString())
  } catch (error) {
    // The records are gone; the lifecycle rule cannot reach pinned/ objects.
    logError('file_transfer.pinned_delete_failed', error, { group_id: groupId.toHexString() })

    return
  }
  for (const item of pinned) {
    await provider
      .deleteObject({ bucket: item.bucket, region: item.region, key: item.objectKey })
      .catch((error: unknown) => {
        logError('file_transfer.pinned_delete_failed', error, { group_id: groupId.toHexString() })
      })
  }
}