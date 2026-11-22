// A finalize and a release of the same group, interleaved: the file is either
// delivered and keeps its slot, or refunded and never delivered, never both.
import { beforeEach, expect, test } from 'bun:test'
import { ObjectId } from 'mongodb'

import type { FileTransferGroup, FileTransferItem } from '@/models'

import { real } from '@/lib/test/doubles/file-transfer-service'
import { useModels } from '@/lib/test/doubles/models'
import { useStorage } from '@/lib/test/doubles/storage'

const teamId = new ObjectId()
const scope = { teamId, userId: 'user' }
let group: FileTransferGroup
let item: FileTransferItem
let refunds = 0
// Runs once, at the moment its trigger is reached inside finalizeTransfer.
let onHead: (() => Promise<void>) | undefined
let onFirstReadyWrite: (() => Promise<void>) | undefined

type Filter = Record<string, unknown> & { _id: unknown }
type Update = { $set: Record<string, unknown> }

/** The parts of a MongoDB filter these two writers use, matched against the stored group. */
function matches(filter: Filter): boolean {
  if (filter.status && group.status === 'ready') return false
  if (filter.admission && !group.admission) return false
  if (filter['admission.releasedAt'] && group.admission?.releasedAt) return false

  return true
}

async function readyWritten(update: Update) {
  if (update.$set.status !== 'ready' || !onFirstReadyWrite) return
  const hook = onFirstReadyWrite

  onFirstReadyWrite = undefined
  await hook()
}

useModels({
  fileTransferGroups: () => ({
    findOne: async () => ({ ...group }),
    updateOne: async (filter: Filter, update: Update) => {
      if (!matches(filter)) return { matchedCount: 0, modifiedCount: 0 }
      const releasedAt = update.$set['admission.releasedAt'] as Date | undefined

      if (releasedAt) group.admission = { ...group.admission!, releasedAt }
      else group.status = update.$set.status as FileTransferGroup['status']
      await readyWritten(update)

      return { matchedCount: 1, modifiedCount: 1 }
    },
  }),
  fileTransferItems: () => ({
    find: () => ({ toArray: async () => [{ ...item }] }),
    updateOne: async (_filter: unknown, update: Update) => {
      item = { ...item, ...update.$set }
      await readyWritten(update)

      return { matchedCount: 1, modifiedCount: 1 }
    },
  }),
  fileTransferAdmissions: () => ({
    updateOne: async () => {
      refunds++

      return { matchedCount: 1, modifiedCount: 1 }
    },
  }),
})
useStorage({
  getStorageProvider: () => ({
    id: 'test',
    bucket: 'test',
    region: 'test',
    // The file is in storage: it landed late, after the computer gave up on it.
    headObject: async () => {
      const hook = onHead

      onHead = undefined
      await hook?.()

      return { size: 10, contentType: null }
    },
    deleteObject: async () => {},
  }),
})

beforeEach(() => {
  const groupId = new ObjectId()

  group = {
    _id: groupId,
    teamId,
    userId: 'user',
    direction: 'upload',
    status: 'pending',
    storageProvider: 'test',
    admission: { key: `${teamId.toHexString()}:0`, bytes: 10 },
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 60_000),
  }
  item = {
    _id: new ObjectId(),
    groupId,
    teamId,
    fileName: 'late.txt',
    relPath: 'late.txt',
    declaredSize: 10,
    contentType: null,
    storageProvider: 'test',
    bucket: 'test',
    region: 'test',
    objectKey: 'late',
    status: 'pending',
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 60_000),
  }
  refunds = 0
  onHead = undefined
  onFirstReadyWrite = undefined
})

const id = () => group._id.toHexString()

test('a finalize that loaded the group before its release never delivers the file', async () => {
  // The release claims the group while this finalize is checking storage.
  onHead = () => real.releaseTransfer(scope, id())
  const result = await real.finalizeTransfer(scope, id())

  expect(refunds).toBe(1)
  expect(result.status).not.toBe('ready')
  expect(result.files[0]?.status).toBe('failed')
  expect(group.status).not.toBe('ready')
  expect(item.status).toBe('failed')
})

test('a release that claims once finalize has marked the file ready gives nothing back', async () => {
  // The release starts as soon as finalize writes its first "ready".
  onFirstReadyWrite = () => real.releaseTransfer(scope, id())
  const result = await real.finalizeTransfer(scope, id())

  expect(result.status).toBe('ready')
  expect(group.status).toBe('ready')
  expect(item.status).toBe('ready')
  expect(refunds).toBe(0)
})
