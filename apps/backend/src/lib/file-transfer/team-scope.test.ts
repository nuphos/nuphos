import { beforeEach, expect, test } from 'bun:test'
import { ObjectId } from 'mongodb'

import { useDb } from '@/lib/test/doubles/db'

import { loadGroup } from './service-shared'

import type * as dbActual from '@/lib/db'

type Doc = Record<string, unknown>

function matches(doc: Doc, filter: Doc): boolean {
  return Object.entries(filter).every(([key, value]) =>
    value instanceof ObjectId ? value.equals(doc[key] as ObjectId) : doc[key] === value,
  )
}

const groups: Doc[] = []

useDb({
  db: (() => ({
    collection: () => ({
      findOne: async (filter: Doc) => groups.find((d) => matches(d, filter)) ?? null,
    }),
  })) as unknown as typeof dbActual.db,
})

const teamId = new ObjectId()
const otherTeamId = new ObjectId()
const groupId = new ObjectId()

beforeEach(() => {
  groups.splice(0, groups.length, {
    _id: groupId,
    teamId,
    userId: 'owner',
    sessionId: 'producer',
    direction: 'download',
    status: 'ready',
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 60000),
  })
})

const load = (userId: string, sessionId?: string, team = teamId) =>
  loadGroup({ teamId: team, userId, sessionId }, groupId.toHexString())

test('any conversation, member or bot of the team can read the group by id', async () => {
  for (const [userId, sessionId] of [
    ['owner', 'producer'],
    ['owner', 'sibling'],
    ['teammate', 'teammate-conversation'],
    ['teammate', undefined],
  ] as const) {
    expect((await load(userId, sessionId))._id.equals(groupId)).toBe(true)
  }
})

test('another team cannot read the group', async () => {
  await expect(load('owner', 'producer', otherTeamId)).rejects.toThrow('File transfer not found')
})

test('an expired group is gone for everyone', async () => {
  groups[0]!.expiresAt = new Date(Date.now() - 1)
  await expect(load('owner', 'producer')).rejects.toThrow('File transfer has expired')
})
