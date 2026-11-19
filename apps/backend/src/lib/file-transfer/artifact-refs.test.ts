import { beforeEach, expect, test } from 'bun:test'
import { ObjectId } from 'mongodb'

import { useDb } from '@/lib/test/doubles/db'
import { useModels } from '@/lib/test/doubles/models'
import { useStorage } from '@/lib/test/doubles/storage'

import {
  extractReplyImageGroupIds,
  purgeConversationFileTransferRefs,
  recordArtifactFileRefs,
} from './artifact-refs'
import { pinnedObjectKey } from './pinning'

import type { FileTransferGroup, FileTransferItem, FileTransferRef } from '@/models'

const teamId = new ObjectId()

let groups: FileTransferGroup[] = []
let items: FileTransferItem[] = []
let refs: FileTransferRef[] = []
let copies: { from: string; to: string }[] = []
let deleted: string[] = []
let onRefDelete: (() => void) | undefined

// One write at a time here, so a transaction is just its body.
useDb({ withTransaction: async (body) => body({} as never) })

useModels({
  fileTransferGroups: () => ({
    findOne: async (filter: Record<string, unknown>) => {
      const found = groups.find((candidate) => matchesGroup(candidate, filter))

      return found ? { ...found } : null
    },
    updateOne: async (
      filter: Record<string, unknown>,
      update: { $inc?: { refCount?: number } },
    ) => {
      const found = groups.find((candidate) => matchesGroup(candidate, filter))

      if (!found) return { matchedCount: 0, modifiedCount: 0 }
      if (update.$inc?.refCount) found.refCount = (found.refCount ?? 0) + update.$inc.refCount

      return { matchedCount: 1, modifiedCount: 1 }
    },
    findOneAndUpdate: async (
      filter: Record<string, unknown>,
      update: { $set?: Record<string, unknown>; $inc?: { refCount?: number } },
    ) => {
      const found = groups.find((candidate) => matchesGroup(candidate, filter))

      if (!found) return null
      if (update.$inc?.refCount) found.refCount = (found.refCount ?? 0) + update.$inc.refCount
      if (update.$set?.pinnedAt) {
        found.pinnedAt = update.$set.pinnedAt as Date
        delete found.expiresAt
      }

      return { ...found }
    },
    deleteOne: async (filter: Record<string, unknown>) => {
      const index = groups.findIndex((candidate) => matchesGroup(candidate, filter))

      if (index === -1) return { deletedCount: 0 }
      groups.splice(index, 1)

      return { deletedCount: 1 }
    },
  }),
  fileTransferItems: () => ({
    find: (filter: Record<string, unknown>) => ({
      toArray: async () =>
        items
          .filter((candidate) => matchesItem(candidate, filter))
          .map((candidate) => ({ ...candidate })),
    }),
    updateOne: async (
      filter: Record<string, unknown>,
      update: { $set: Record<string, unknown> },
    ) => {
      const found = items.find((candidate) => matchesItem(candidate, filter))

      if (!found) return { matchedCount: 0, modifiedCount: 0 }
      Object.assign(found, update.$set)
      delete found.expiresAt

      return { matchedCount: 1, modifiedCount: 1 }
    },
    deleteMany: async (filter: Record<string, unknown>) => {
      const before = items.length

      items = items.filter((candidate) => !matchesItem(candidate, filter))

      return { deletedCount: before - items.length }
    },
  }),
  fileTransferRefs: () => ({
    find: (filter: Record<string, unknown>) => ({
      toArray: async () =>
        refs.filter((ref) => ref.sessionId === filter.sessionId).map((ref) => ({ ...ref })),
    }),
    updateOne: async (
      filter: Record<string, unknown>,
      update: { $setOnInsert: Omit<FileTransferRef, '_id'> },
      options?: { upsert?: boolean },
    ) => {
      if (refs.some((ref) => matchesRef(ref, filter))) return { upsertedCount: 0 }
      if (!options?.upsert) return { upsertedCount: 0 }
      refs.push({ _id: new ObjectId(), ...update.$setOnInsert })

      return { upsertedCount: 1 }
    },
    deleteMany: async (filter: Record<string, unknown>) => {
      const hook = onRefDelete

      onRefDelete = undefined
      hook?.()
      const before = refs.length

      refs = refs.filter(
        (ref) =>
          !(
            ref.groupId.equals(filter.groupId as ObjectId) && ref.sessionId === filter.sessionId
          ),
      )

      return { deletedCount: before - refs.length }
    },
  }),
})

useStorage({
  getStorageProvider: () => ({
    id: 'test',
    bucket: 'test',
    region: 'test',
    copyObject: async (src: { key: string }, destKey: string) => {
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
  const ceiling = (filter.refCount as { $lte?: number } | undefined)?.$lte

  if (ceiling !== undefined && (candidate.refCount ?? 0) > ceiling) return false
  const after = (filter.expiresAt as { $gt?: Date } | undefined)?.$gt

  return !after || (candidate.expiresAt !== undefined && candidate.expiresAt > after)
}

function matchesItem(candidate: FileTransferItem, filter: Record<string, unknown>): boolean {
  const id = filter._id

  if (id instanceof ObjectId && !id.equals(candidate._id)) return false
  const group = filter.groupId

  if (group instanceof ObjectId && !group.equals(candidate.groupId)) return false
  if (filter.status && candidate.status !== filter.status) return false

  return true
}

function matchesRef(candidate: FileTransferRef, filter: Record<string, unknown>): boolean {
  const group = filter.groupId

  if (group instanceof ObjectId && !group.equals(candidate.groupId)) return false
  if (typeof filter.sessionId === 'string' && candidate.sessionId !== filter.sessionId) return false
  if (typeof filter.artifactId === 'string' && candidate.artifactId !== filter.artifactId)
    return false

  return true
}

function makeGroup(overrides: Partial<FileTransferGroup> = {}): FileTransferGroup {
  return {
    _id: new ObjectId(),
    teamId,
    userId: 'user',
    direction: 'download',
    status: 'ready',
    storageProvider: 'test',
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 60_000),
    ...overrides,
  }
}

function makeItems(group: FileTransferGroup, pinned = false): FileTransferItem[] {
  const id = new ObjectId()

  return [
    {
      _id: id,
      groupId: group._id,
      teamId: group.teamId,
      fileName: 'clip.mp4',
      relPath: 'clip.mp4',
      declaredSize: 10,
      contentType: 'video/mp4',
      storageProvider: 'test',
      bucket: 'test',
      region: 'test',
      objectKey: pinned
        ? pinnedObjectKey(group.teamId, group._id, id)
        : `transfers/${group.teamId.toHexString()}/${group._id.toHexString()}/${id.toHexString()}`,
      status: 'ready',
      createdAt: new Date(),
      ...(pinned
        ? { pinnedAt: new Date() }
        : { expiresAt: new Date(Date.now() + 60_000) }),
    },
  ]
}

function makeRef(group: FileTransferGroup, sessionId: string): FileTransferRef {
  return {
    _id: new ObjectId(),
    teamId: group.teamId,
    groupId: group._id,
    sessionId,
    artifactId: 'report',
    createdAt: new Date(),
  }
}

function link(groupId: ObjectId): string {
  return `![clip](https://nuphos.ai/_reply-images/${groupId.toHexString()})`
}

beforeEach(() => {
  groups = []
  items = []
  refs = []
  copies = []
  deleted = []
  onRefDelete = undefined
})

test('extracts every valid group id once', () => {
  const a = new ObjectId().toHexString()
  const b = new ObjectId().toHexString()
  const content = [
    `![a](https://nuphos.ai/_reply-images/${a})`,
    `![a again](https://nuphos.ai/_reply-images/${a})`,
    `![b](https://nuphos.ai/_reply-images/${b})`,
    '![bad](https://nuphos.ai/_reply-images/not-a-group)',
    `![long](https://nuphos.ai/_reply-images/${a}0)`,
  ].join('\n')

  expect(extractReplyImageGroupIds(content)).toEqual([a, b])
})

test('records one ref and pins the cited group', async () => {
  const group = makeGroup()

  groups.push(group)
  items.push(...makeItems(group))

  await recordArtifactFileRefs({
    teamId: teamId.toHexString(),
    sessionId: 'session',
    artifactId: 'report',
    content: link(group._id),
  })

  expect(refs).toHaveLength(1)
  expect(refs[0]).toMatchObject({
    teamId,
    groupId: group._id,
    sessionId: 'session',
    artifactId: 'report',
  })
  expect(copies).toHaveLength(1)
  expect(groups[0]?.pinnedAt).toBeDefined()
  expect(groups[0]?.expiresAt).toBeUndefined()
})

test('ignores invalid ids and groups owned by another team', async () => {
  const foreign = makeGroup({ teamId: new ObjectId() })

  groups.push(foreign)
  items.push(...makeItems(foreign))

  await recordArtifactFileRefs({
    teamId: teamId.toHexString(),
    sessionId: 'session',
    artifactId: 'report',
    content: `${link(foreign._id)}\n![bad](https://nuphos.ai/_reply-images/not-a-group)`,
  })

  expect(refs).toEqual([])
  expect(copies).toEqual([])
})

test('cites a group once when its link appears twice', async () => {
  const group = makeGroup()

  groups.push(group)
  items.push(...makeItems(group))

  await recordArtifactFileRefs({
    teamId: teamId.toHexString(),
    sessionId: 'session',
    artifactId: 'report',
    content: `${link(group._id)}\n${link(group._id)}`,
  })

  expect(refs).toHaveLength(1)
  expect(copies).toHaveLength(1)
})

test('a group cited by two conversations survives releasing one of them', async () => {
  const group = makeGroup({ refCount: 2 })
  const [item] = makeItems(group, true)

  groups.push(group)
  items.push(item!)
  refs.push(makeRef(group, 'one'), makeRef(group, 'two'))

  await purgeConversationFileTransferRefs('one')

  expect(groups).toHaveLength(1)
  expect(items).toHaveLength(1)
  expect(refs.map((ref) => ref.sessionId)).toEqual(['two'])
  expect(deleted).toEqual([])

  await purgeConversationFileTransferRefs('two')

  expect(groups).toEqual([])
  expect(items).toEqual([])
  expect(refs).toEqual([])
  expect(deleted).toEqual([pinnedObjectKey(teamId, group._id, item!._id)])
})

test('a ref added while the last one is released keeps the group', async () => {
  const group = makeGroup({ refCount: 1 })

  groups.push(group)
  items.push(...makeItems(group, true))
  refs.push(makeRef(group, 'one'))
  onRefDelete = () => {
    refs.push(makeRef(group, 'two'))
    group.refCount = (group.refCount ?? 0) + 1
  }

  await purgeConversationFileTransferRefs('one')

  expect(groups).toHaveLength(1)
  expect(refs.map((ref) => ref.sessionId)).toEqual(['two'])
  expect(group.refCount).toBe(1)
  expect(deleted).toEqual([])
})