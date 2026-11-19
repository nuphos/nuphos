import { beforeEach, expect, test } from 'bun:test'
import { ObjectId } from 'mongodb'

import { useDb } from '@/lib/test/doubles/db'
import { useModels } from '@/lib/test/doubles/models'
import { useStorage } from '@/lib/test/doubles/storage'

import { PINNED_OBJECT_PREFIX, pinTransferGroup, pinnedObjectKey } from './pinning'

import type { FileTransferGroup, FileTransferItem } from '@/models'

const teamId = new ObjectId()
const groupId = new ObjectId()
const itemId = new ObjectId()

let group: FileTransferGroup | null
let items: FileTransferItem[]
let copies: { from: string; to: string }[] = []
let deleted: string[] = []
let copyFails = false
let onConditionalUpdate: (() => void) | undefined

// One write at a time here, so a transaction is just its body.
useDb({ withTransaction: async (body) => body({} as never) })

useModels({
  fileTransferGroups: () => ({
    findOne: async (filter: Record<string, unknown>) =>
      group && matchesGroup(group, filter) ? { ...group } : null,
    findOneAndUpdate: async (
      filter: Record<string, unknown>,
      update: { $set: Record<string, unknown> },
    ) => {
      const hook = onConditionalUpdate

      onConditionalUpdate = undefined
      hook?.()
      if (!group || !matchesGroup(group, filter)) return null
      group = { ...group, pinnedAt: update.$set.pinnedAt as Date }
      delete group.expiresAt

      return { ...group }
    },
  }),
  fileTransferItems: () => ({
    find: () => ({ toArray: async () => items.map((item) => ({ ...item })) }),
    updateOne: async (
      filter: Record<string, unknown>,
      update: { $set: Record<string, unknown> },
    ) => {
      const item = items.find((candidate) => matchesItem(candidate, filter))

      if (!item) return { matchedCount: 0, modifiedCount: 0 }
      Object.assign(item, update.$set)
      delete item.expiresAt

      return { matchedCount: 1, modifiedCount: 1 }
    },
  }),
})

useStorage({
  getStorageProvider: () => ({
    id: 'test',
    bucket: 'test',
    region: 'test',
    copyObject: async (src: { key: string }, destKey: string) => {
      if (copyFails) throw new Error('copy unavailable')
      copies.push({ from: src.key, to: destKey })
    },
    deleteObject: async (ref: { key: string }) => {
      deleted.push(ref.key)
    },
  }),
})

function matchesGroup(candidate: FileTransferGroup, filter: Record<string, unknown>): boolean {
  const id = filter._id

  if (id instanceof ObjectId && !id.equals(candidate._id)) return false
  const owner = filter.teamId

  if (owner instanceof ObjectId && !owner.equals(candidate.teamId)) return false
  if (filter.status && candidate.status !== filter.status) return false
  if (filter.pinnedAt && candidate.pinnedAt) return false
  const after = (filter.expiresAt as { $gt?: Date } | undefined)?.$gt

  return !after || (candidate.expiresAt !== undefined && candidate.expiresAt > after)
}

function matchesItem(candidate: FileTransferItem, filter: Record<string, unknown>): boolean {
  const id = filter._id

  if (id instanceof ObjectId && !id.equals(candidate._id)) return false
  if (filter.status && candidate.status !== filter.status) return false

  return true
}

beforeEach(() => {
  group = {
    _id: groupId,
    teamId,
    userId: 'user',
    direction: 'download',
    status: 'ready',
    storageProvider: 'test',
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 60_000),
  }
  items = [
    {
      _id: itemId,
      groupId,
      teamId,
      fileName: 'clip.mp4',
      relPath: 'clip.mp4',
      declaredSize: 10,
      contentType: 'video/mp4',
      storageProvider: 'test',
      bucket: 'test',
      region: 'test',
      objectKey: `transfers/${teamId.toHexString()}/${groupId.toHexString()}/${itemId.toHexString()}`,
      status: 'ready',
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
    },
  ]
  copies = []
  deleted = []
  copyFails = false
  onConditionalUpdate = undefined
})

test('pins a ready group by copying its objects and moving the records', async () => {
  const originalKey = items[0]!.objectKey
  const pinnedKey = pinnedObjectKey(teamId, groupId, itemId)

  expect(await pinTransferGroup(teamId, groupId)).toBe('pinned')
  expect(copies).toEqual([{ from: originalKey, to: pinnedKey }])
  expect(group?.pinnedAt).toBeDefined()
  expect(group?.expiresAt).toBeUndefined()
  expect(items[0]?.objectKey).toBe(pinnedKey)
  expect(items[0]?.pinnedAt).toBeDefined()
  expect(items[0]?.expiresAt).toBeUndefined()
  expect(pinnedKey.startsWith(PINNED_OBJECT_PREFIX)).toBe(true)
  // The old object is unreferenced; the lifecycle rule is only a backstop.
  expect(deleted).toEqual([originalKey])
})

test('pinning twice is a no-op', async () => {
  await pinTransferGroup(teamId, groupId)
  copies = []
  deleted = []

  expect(await pinTransferGroup(teamId, groupId)).toBe('already_pinned')
  expect(copies).toEqual([])
  expect(deleted).toEqual([])
  expect(items[0]?.objectKey).toBe(pinnedObjectKey(teamId, groupId, itemId))
})

test('a group that is not ready keeps its 24h expiry', async () => {
  group = { ...group!, status: 'pending' }

  expect(await pinTransferGroup(teamId, groupId)).toBe('not_ready')
  expect(copies).toEqual([])
  expect(group?.expiresAt).toBeDefined()
  expect(group?.pinnedAt).toBeUndefined()
})

test('a group that expires before the conditional update is not pinned', async () => {
  const originalKey = items[0]!.objectKey

  onConditionalUpdate = () => {
    group = { ...group!, expiresAt: new Date(Date.now() - 1) }
  }

  expect(await pinTransferGroup(teamId, groupId)).toBe('expired')
  expect(group?.pinnedAt).toBeUndefined()
  expect(group?.expiresAt).toBeDefined()
  expect(items[0]?.objectKey).toBe(originalKey)
  expect(items[0]?.expiresAt).toBeDefined()
})

test('copies made for a group the TTL removed in the meantime are discarded', async () => {
  const pinnedKey = pinnedObjectKey(teamId, groupId, itemId)

  onConditionalUpdate = () => {
    group = null
  }

  expect(await pinTransferGroup(teamId, groupId)).toBe('missing')
  expect(deleted).toEqual([pinnedKey])
})

test('a failed copy leaves the unpinned records untouched', async () => {
  const originalKey = items[0]!.objectKey

  copyFails = true

  await expect(pinTransferGroup(teamId, groupId)).rejects.toThrow('copy unavailable')
  expect(group?.pinnedAt).toBeUndefined()
  expect(items[0]?.objectKey).toBe(originalKey)
  expect(items[0]?.expiresAt).toBeDefined()
})