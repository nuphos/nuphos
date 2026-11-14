import { beforeEach, expect, test } from 'bun:test'
import { ObjectId } from 'mongodb'

import { real } from '@/lib/test/doubles/file-transfer-service'
import { useModels } from '@/lib/test/doubles/models'
import { useStorage } from '@/lib/test/doubles/storage'

const teamId = new ObjectId()
const groupId = new ObjectId()
let actualSize = 10
let deleted = false
let readyWrites = 0
let deleteFails = false

useModels({
  fileTransferGroups: () => ({
    findOne: async () => ({
      _id: groupId,
      teamId,
      userId: 'user',
      direction: 'upload',
      status: 'pending',
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 60000),
    }),
    updateOne: async () => ({ modifiedCount: 1 }),
    insertOne: async () => ({}),
  }),
  fileTransferAdmissions: () => ({ updateOne: async () => ({ modifiedCount: 1 }) }),
  fileTransferItems: () => ({
    find: () => ({
      toArray: async () => [
        {
          _id: new ObjectId(),
          groupId,
          teamId,
          fileName: 'test.txt',
          declaredSize: 10,
          status: 'pending',
          bucket: 'test',
          region: 'test',
          objectKey: 'test',
        },
      ],
    }),
    updateOne: async (_filter: unknown, update: { $set: { status: string } }) => {
      if (update.$set.status === 'ready') readyWrites++

      return { modifiedCount: 1 }
    },
    insertMany: async () => ({}),
  }),
})
useStorage({
  getStorageProvider: () => ({
    id: 'test',
    bucket: 'test',
    region: 'test',
    presignUpload: async () => ({ url: 'https://upload.test', expiresAt: new Date() }),
    headObject: async () => ({ size: actualSize, contentType: null }),
    deleteObject: async () => {
      if (deleteFails) throw new Error('delete unavailable')
      deleted = true
    },
  }),
})

beforeEach(() => {
  actualSize = 10
  deleted = false
  readyWrites = 0
  deleteFails = false
})

test('finalization accepts the declared size', async () => {
  const result = await real.finalizeTransfer({ teamId, userId: 'user' }, groupId.toHexString())

  expect(result.status).toBe('ready')
  expect(readyWrites).toBe(1)
  expect(deleted).toBe(false)
})

test('finalization deletes and rejects a mismatched object', async () => {
  actualSize = 11
  const result = await real.finalizeTransfer({ teamId, userId: 'user' }, groupId.toHexString())

  expect(result.status).toBe('failed')
  expect(result.files[0]?.downloadUrl).toBeUndefined()
  expect(readyWrites).toBe(0)
  expect(deleted).toBe(true)
})

test('failed deletion never marks a mismatched object ready', async () => {
  actualSize = 11
  deleteFails = true
  await expect(
    real.finalizeTransfer({ teamId, userId: 'user' }, groupId.toHexString()),
  ).rejects.toThrow('delete unavailable')
  expect(readyWrites).toBe(0)
})

test('group ids carry no timestamp or per-process prefix a neighbour could reveal', async () => {
  const create = async () =>
    new ObjectId(
      (
        await real.createTransfer({ teamId, userId: 'user' }, 'download', [
          { fileName: 'a.txt', size: 1 },
        ])
      ).groupId,
    )
  const [a, b] = [await create(), await create()]
  const hex = (id: ObjectId) => id.toHexString()

  // A default ObjectId shares its first 18 hex chars (timestamp + process value)
  // with every id minted in the same second by the same process.
  expect(hex(a).slice(0, 18)).not.toBe(hex(b).slice(0, 18))
})
