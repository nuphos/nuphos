// Core file-transfer service, shared by the team-scoped (Desktop) and
// agent-session-scoped (sandbox) routes.
//
// Mechanics are symmetric across directions: a *producer* writes objects via
// presigned PUT, finalize confirms them, and a *consumer* reads via presigned
// GET. `direction` only records the UI semantics (who produces vs consumes):
//   upload   → user produces (PUT),  agent consumes (GET)
//   download → agent produces (PUT), user consumes (GET)
//
// The store is fully decoupled from the agent sandbox: nothing here touches a
// sandbox or its lease. TTL lives on the records (Mongo) + the bucket
// lifecycle rule.

import { ObjectId } from 'mongodb'

import { admitFileTransfer } from './admission'
import { groupStatusFrom, loadGroup, objectKey, validateInputs, view } from './service-shared'

import type {
  CreatedItemView,
  CreatedTransferView,
  FileIntentInput,
  TransferGroupView,
  TransferScope,
} from './service-shared'
import type { FileTransferDirection, FileTransferGroup, FileTransferItem } from '@/models'

import { config } from '@/config'
import { getStorageProvider } from '@/lib/storage'
import { fileTransferGroups, fileTransferItems } from '@/models'

export type {
  CreatedItemView,
  CreatedTransferView,
  FileIntentInput,
  ResolvedFileView,
  TransferGroupView,
  TransferScope,
} from './service-shared'

export async function createTransfer(
  scope: TransferScope,
  direction: FileTransferDirection,
  files: FileIntentInput[],
  label?: string,
): Promise<CreatedTransferView> {
  validateInputs(files)
  const provider = getStorageProvider(scope.teamId.toHexString())

  await admitFileTransfer(
    scope.teamId.toHexString(),
    files.reduce((sum, file) => sum + file.size, 0),
  )

  const now = new Date()
  const expiresAt = new Date(now.getTime() + config.fileTransfer.ttlSeconds * 1000)
  const groupId = new ObjectId()

  const group: FileTransferGroup = {
    _id: groupId,
    teamId: scope.teamId,
    userId: scope.userId,
    ...(scope.sessionId ? { sessionId: scope.sessionId } : {}),
    direction,
    status: 'pending',
    storageProvider: provider.id,
    ...(label ? { label } : {}),
    createdAt: now,
    expiresAt,
  }

  const items: FileTransferItem[] = []
  const created: CreatedItemView[] = []

  for (const f of files) {
    const itemId = new ObjectId()
    const key = objectKey(scope.teamId, groupId, itemId)
    const contentType = f.contentType ?? null
    const presigned = await provider.presignUpload(
      key,
      contentType,
      config.fileTransfer.presignExpirySeconds,
      f.size,
    )

    items.push({
      _id: itemId,
      groupId,
      teamId: scope.teamId,
      fileName: f.fileName,
      relPath: f.relPath ?? f.fileName,
      declaredSize: f.size,
      contentType,
      storageProvider: provider.id,
      bucket: provider.bucket,
      region: provider.region,
      objectKey: key,
      status: 'pending',
      createdAt: now,
      expiresAt,
    })
    created.push({
      id: itemId.toHexString(),
      fileName: f.fileName,
      relPath: f.relPath ?? f.fileName,
      uploadUrl: presigned.url,
      expiresAt: presigned.expiresAt.toISOString(),
    })
  }

  await fileTransferGroups().insertOne(group)
  await fileTransferItems().insertMany(items)

  return {
    groupId: groupId.toHexString(),
    direction,
    status: 'pending',
    expiresAt: expiresAt.toISOString(),
    files: created,
  }
}

// Confirm every produced object exists; set per-item + group status.
export async function finalizeTransfer(
  scope: TransferScope,
  groupId: string,
): Promise<TransferGroupView> {
  const group = await loadGroup(scope, groupId)
  const provider = getStorageProvider(scope.teamId.toHexString())
  const items = await fileTransferItems().find({ groupId: group._id }).toArray()

  for (const item of items) {
    if (item.status === 'ready') continue
    const head = await provider.headObject({
      bucket: item.bucket,
      region: item.region,
      key: item.objectKey,
    })

    if (head && head.size !== item.declaredSize) {
      await provider.deleteObject({ bucket: item.bucket, region: item.region, key: item.objectKey })
    }
    if (head && head.size === item.declaredSize) {
      item.status = 'ready'
      item.actualSize = head.size
      item.finalizedAt = new Date()
      await fileTransferItems().updateOne(
        { _id: item._id },
        { $set: { status: 'ready', actualSize: head.size, finalizedAt: item.finalizedAt } },
      )
    } else {
      item.status = 'failed'
      await fileTransferItems().updateOne({ _id: item._id }, { $set: { status: 'failed' } })
    }
  }

  const status = groupStatusFrom(items)

  await fileTransferGroups().updateOne({ _id: group._id }, { $set: { status } })
  group.status = status

  return view(group, items)
}

// Issue presigned GET URLs for every ready item (consumer side).
export async function resolveDownloads(
  scope: TransferScope,
  groupId: string,
): Promise<TransferGroupView> {
  const group = await loadGroup(scope, groupId)
  const provider = getStorageProvider(scope.teamId.toHexString())
  const items = await fileTransferItems().find({ groupId: group._id }).toArray()

  return view(group, items, provider)
}

// List a scope's transfer groups in a direction (most recent first), e.g. the
// download groups an agent produced in a conversation. No presigned URLs here
// — those are minted on-demand by resolveDownloads when the user clicks.
export async function listTransferGroups(
  scope: TransferScope,
  direction: FileTransferDirection,
  limit = 50,
): Promise<TransferGroupView[]> {
  const filter: Record<string, unknown> = {
    teamId: scope.teamId,
    userId: scope.userId,
    direction,
  }

  if (scope.sessionId) filter.sessionId = scope.sessionId
  const groups = await fileTransferGroups()
    .find(filter)
    .sort({ createdAt: -1 })
    .limit(limit)
    .toArray()

  if (groups.length === 0) return []
  const items = await fileTransferItems()
    .find({ groupId: { $in: groups.map((g) => g._id) } })
    .toArray()
  const byGroup = new Map<string, FileTransferItem[]>()

  for (const item of items) {
    const key = item.groupId.toHexString()
    const list = byGroup.get(key) ?? []

    list.push(item)
    byGroup.set(key, list)
  }
  // Only surface groups that have at least one downloadable file — a failed
  // create (group exists but no object landed) is noise, not a download card.
  const usable = groups.filter((g) =>
    (byGroup.get(g._id.toHexString()) ?? []).some((i) => i.status === 'ready'),
  )

  return Promise.all(usable.map((g) => view(g, byGroup.get(g._id.toHexString()) ?? [])))
}

// Download groups a conversation pushed after `since`, with presigned GET
// URLs already minted for their ready files. Used to mirror agent-produced
// files into chat surfaces (e.g. Slack thread attachments) right after a turn
// finishes. Unlike listTransferGroups this is not scoped to one userId: a
// synthetic turn (plan approval) pushes with the approver's token, not the
// session owner's.
export async function listSessionDownloadsSince(args: {
  teamId: ObjectId
  sessionId: string
  since: Date
}): Promise<TransferGroupView[]> {
  const groups = await fileTransferGroups()
    .find({
      teamId: args.teamId,
      sessionId: args.sessionId,
      direction: 'download',
      createdAt: { $gte: args.since },
      expiresAt: { $gt: new Date() },
    })
    .sort({ createdAt: 1 })
    .toArray()

  if (groups.length === 0) return []
  const provider = getStorageProvider(args.teamId.toHexString())
  const items = await fileTransferItems()
    .find({ groupId: { $in: groups.map((g) => g._id) } })
    .toArray()
  const byGroup = new Map<string, FileTransferItem[]>()

  for (const item of items) {
    const key = item.groupId.toHexString()
    const list = byGroup.get(key) ?? []

    list.push(item)
    byGroup.set(key, list)
  }
  const usable = groups.filter((g) =>
    (byGroup.get(g._id.toHexString()) ?? []).some((i) => i.status === 'ready'),
  )

  return Promise.all(usable.map((g) => view(g, byGroup.get(g._id.toHexString()) ?? [], provider)))
}

export async function getTransferGroup(
  scope: TransferScope,
  groupId: string,
): Promise<TransferGroupView> {
  const group = await loadGroup(scope, groupId)
  const items = await fileTransferItems().find({ groupId: group._id }).toArray()

  return view(group, items)
}
