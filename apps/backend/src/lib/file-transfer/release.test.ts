import { beforeEach, expect, test } from 'bun:test'
import { ObjectId } from 'mongodb'

import { releaseTransfer } from './release'

import type { FileTransferGroup } from '@/models'

import { useModels } from '@/lib/test/doubles/models'

const teamId = new ObjectId()
const scope = { teamId, userId: 'user' }
const groups = new Map<string, FileTransferGroup>()
const refunds: { filter: unknown; update: unknown }[] = []

function matches(group: FileTransferGroup, filter: Record<string, unknown>): boolean {
  if (filter.status && group.status === 'ready') return false
  if (filter.admission && !group.admission) return false
  if (filter['admission.releasedAt'] && group.admission?.releasedAt) return false

  return true
}

useModels({
  fileTransferGroups: () => ({
    findOne: async (filter: { _id: ObjectId }) => groups.get(filter._id.toHexString()) ?? null,
    updateOne: async (
      filter: { _id: ObjectId } & Record<string, unknown>,
      update: { $set: { 'admission.releasedAt': Date } },
    ) => {
      const group = groups.get(filter._id.toHexString())

      if (!group || !matches(group, filter)) return { modifiedCount: 0 }
      group.admission = { ...group.admission!, releasedAt: update.$set['admission.releasedAt'] }

      return { modifiedCount: 1 }
    },
  }),
  fileTransferAdmissions: () => ({
    updateOne: async (filter: unknown, update: unknown) => {
      refunds.push({ filter, update })

      return { modifiedCount: 1 }
    },
  }),
})

function group(overrides: Partial<FileTransferGroup> = {}): string {
  const id = new ObjectId()

  groups.set(id.toHexString(), {
    _id: id,
    teamId,
    userId: 'user',
    direction: 'upload',
    status: 'pending',
    storageProvider: 's3',
    admission: { key: `${teamId.toHexString()}:0`, bytes: 10 },
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 60_000),
    ...overrides,
  })

  return id.toHexString()
}

beforeEach(() => {
  groups.clear()
  refunds.length = 0
})

test('a failed group gives back its slot and bytes once, however often it is released', async () => {
  const id = group()

  await releaseTransfer(scope, id)
  await releaseTransfer(scope, id)
  expect(refunds).toEqual([
    {
      filter: { _id: `${teamId.toHexString()}:0`, count: { $gte: 1 }, bytes: { $gte: 10 } },
      update: { $inc: { count: -1, bytes: -10 } },
    },
  ])
})

test('concurrent releases still refund once', async () => {
  const id = group()

  await Promise.all([releaseTransfer(scope, id), releaseTransfer(scope, id)])
  expect(refunds).toHaveLength(1)
})

test('a delivered group keeps its slot', async () => {
  await releaseTransfer(scope, group({ status: 'ready' }))
  expect(refunds).toHaveLength(0)
})

test('a group made before admissions were saved has nothing to give back', async () => {
  await releaseTransfer(scope, group({ admission: undefined }))
  expect(refunds).toHaveLength(0)
})
