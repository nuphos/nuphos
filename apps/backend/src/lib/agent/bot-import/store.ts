import { randomUUID } from 'node:crypto'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

import { GridFSBucket } from 'mongodb'

import { db } from '@/lib/db'
import { AppError } from '@/lib/errors'
import { renderAvatar } from '@/lib/identity/avatar-upload'

import { readBotBundle } from './archive'
import { assertImportOwner, newImportBatch } from './batch'
import { BUNDLE_LIMITS } from './manifest'

import type { ImportBatch, ImportItem, ImportOwner, ImportSelection } from './batch'
import type { ObjectId } from 'mongodb'

type StoredBatch = ImportBatch & {
  _id: string
  fileId: ObjectId
  lease?: string
  leaseUntil?: Date
}
const batches = () => db().collection<StoredBatch>('agent_bot_imports')
const bucket = () => new GridFSBucket(db(), { bucketName: 'agent_bot_import_files' })
const scope = (id: string, owner: ImportOwner) => ({ _id: id, ...owner })

export async function stageBotBundle(owner: ImportOwner, bytes: Uint8Array, copyId = '') {
  const archive = await readBotBundle(bytes)
  const batch = newImportBatch(owner, archive.digest, archive.manifest, copyId)
  const existing = await batches().findOne(scope(batch.id, owner))

  if (existing && existing.expiresAt.getTime() > Date.now()) return existing
  batch.avatars = {}
  for (const bot of batch.manifest.bots) {
    const bytes = bot.avatar && archive.files.get(bot.avatar)

    if (bytes)
      batch.avatars[bot.key] =
        `data:image/webp;base64,${Buffer.from(await renderAvatar(bytes)).toString('base64')}`
  }
  const upload = bucket().openUploadStream('bundle.zip', {
    metadata: { batchId: batch.id, userId: owner.userId, teamId: owner.teamId },
  })

  try {
    await pipeline(Readable.from([bytes]), upload)
    const stored: StoredBatch = { ...batch, _id: batch.id, fileId: upload.id }

    if (existing) {
      await batches().updateOne(
        { ...scope(batch.id, owner), fileId: existing.fileId },
        {
          $set: { fileId: upload.id, expiresAt: batch.expiresAt },
          $unset: { stagedRemoved: '' },
        },
      )
    } else {
      await batches().updateOne(scope(batch.id, owner), { $setOnInsert: stored }, { upsert: true })
    }
    const saved = await getBotImport(batch.id, owner)

    if (!saved.fileId.equals(upload.id)) await bucket().delete(upload.id)
    if (existing && !saved.fileId.equals(existing.fileId))
      await bucket()
        .delete(existing.fileId)
        .catch(() => {})

    return saved
  } catch (error) {
    await upload.abort().catch(() => {})
    await bucket()
      .delete(upload.id)
      .catch(() => {})
    throw error
  }
}

export async function getBotImport(id: string, owner: ImportOwner) {
  const batch = await batches().findOne(scope(id, owner))

  if (!batch) throw new AppError(404, 'import_not_found', 'Import batch not found')
  assertImportOwner(batch, owner)

  return batch
}

export async function readStagedBotBundle(batch: StoredBatch) {
  if (batch.expiresAt.getTime() <= Date.now())
    throw new AppError(410, 'import_expired', 'The export expired. Choose the file again.')
  const chunks: Buffer[] = []
  let total = 0

  for await (const data of bucket().openDownloadStream(batch.fileId)) {
    if (!Buffer.isBuffer(data)) throw new Error('Invalid bundle storage stream')
    total += data.length
    if (total > BUNDLE_LIMITS.uploadBytes) throw new Error('Bundle storage limit exceeded')
    chunks.push(data)
  }
  const archive = await readBotBundle(Buffer.concat(chunks))

  if (archive.digest !== batch.digest) throw new Error('Staged export integrity check failed')

  return archive
}

export async function claimBotImport(id: string, owner: ImportOwner) {
  const now = new Date()
  const lease = randomUUID()
  const batch = await batches().findOneAndUpdate(
    {
      ...scope(id, owner),
      expiresAt: { $gt: now },
      $or: [{ leaseUntil: { $exists: false } }, { leaseUntil: { $lt: now } }],
    },
    { $set: { lease, leaseUntil: new Date(now.getTime() + 180_000) } },
    { returnDocument: 'after' },
  )

  if (!batch)
    throw new AppError(409, 'import_busy', 'This import is already running or has expired')

  return {
    batch,
    select: async (selection: ImportSelection) => {
      const canonical = (value: ImportSelection) =>
        JSON.stringify([
          [...value.botKeys].sort((left, right) => left.localeCompare(right)),
          [...value.chatKeys].sort((left, right) => left.localeCompare(right)),
          value.enableSchedules,
        ])

      if (batch.selection && canonical(batch.selection) !== canonical(selection))
        throw new AppError(
          409,
          'import_selection_changed',
          'Retry with the original selection, or choose an explicit new copy',
        )
      const stored = await batches().updateOne(
        { ...scope(id, owner), lease },
        { $set: { selection } },
      )

      if (!stored.matchedCount) throw new Error('Import lease was lost')
      batch.selection = selection
    },
    save: async (item: ImportItem) => {
      const saved = await batches().updateOne(
        { ...scope(id, owner), lease, 'items.sessionId': item.sessionId },
        {
          $set: { 'items.$': item, leaseUntil: new Date(Date.now() + 180_000) },
        },
      )

      if (!saved.matchedCount) throw new Error('Import lease was lost')
    },
    release: () =>
      batches().updateOne(
        { ...scope(id, owner), lease },
        { $unset: { lease: '', leaseUntil: '' } },
      ),
  }
}

export async function discardBotImport(id: string, owner: ImportOwner) {
  const batch = await getBotImport(id, owner)

  if (batch.leaseUntil && batch.leaseUntil.getTime() > Date.now())
    throw new AppError(409, 'import_busy', 'Wait for the current import to finish')
  await bucket()
    .delete(batch.fileId)
    .catch(() => {})
  // Preserve the source mapping and result receipt; discard only the staged bytes.
  await batches().updateOne(scope(id, owner), {
    $set: { expiresAt: new Date(), stagedRemoved: true },
  })
}

export function botImportPreview(batch: ImportBatch & { leaseUntil?: Date }) {
  return {
    id: batch.id,
    digest: batch.digest,
    target: { runtimeId: batch.runtimeId, agentRuntime: batch.agentRuntime },
    expiresAt: batch.expiresAt,
    manifest: batch.manifest,
    items: batch.items,
    avatars: batch.avatars,
    selection: batch.selection,
    running: Boolean(batch.leaseUntil && batch.leaseUntil.getTime() > Date.now()),
  }
}
