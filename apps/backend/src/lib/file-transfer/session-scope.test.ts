import { beforeEach, expect, test } from 'bun:test'
import { ObjectId } from 'mongodb'

import { useDb } from '@/lib/test/doubles/db'

import { loadGroup } from './service-shared'

import type * as dbActual from '@/lib/db'

type Doc = Record<string, unknown>

function matches(doc: Doc, filter: Doc): boolean {
  return Object.entries(filter).every(([key, value]) => {
    if (key === '$or') return (value as Doc[]).some((branch) => matches(doc, branch))
    const actual = doc[key]

    if (value instanceof ObjectId) return value.equals(actual as ObjectId)
    if (value && typeof value === 'object') {
      const op = value as { $in?: unknown[]; $exists?: boolean }

      if (op.$in) return op.$in.includes(actual)
      if (op.$exists !== undefined) return (actual !== undefined) === op.$exists
    }

    return actual === value
  })
}

const collections = { agent_conversations: [] as Doc[], file_transfer_groups: [] as Doc[] }
const docs = (name: string) => collections[name as keyof typeof collections]

useDb({
  db: (() => ({
    collection: (name: string) => ({
      find: (filter: Doc) => ({
        toArray: async () => docs(name).filter((d) => matches(d, filter)),
      }),
      findOne: async (filter: Doc) => docs(name).find((d) => matches(d, filter)) ?? null,
    }),
  })) as unknown as typeof dbActual.db,
})

const teamId = new ObjectId()
const otherTeamId = new ObjectId()
const groupId = new ObjectId()

// root ── parent ── child (pushes the group); root ── sibling; unrelated stands alone.
function conversation(
  sessionId: string,
  parentSessionId?: string,
  userId = 'owner',
  team = teamId,
) {
  return {
    sessionId,
    userId,
    teamId: team.toHexString(),
    ...(parentSessionId ? { parentSessionId } : {}),
  }
}

beforeEach(() => {
  collections.agent_conversations = [
    conversation('root'),
    conversation('parent', 'root'),
    conversation('child', 'parent'),
    conversation('sibling', 'root'),
    conversation('unrelated'),
  ]
  collections.file_transfer_groups = [
    {
      _id: groupId,
      teamId,
      userId: 'owner',
      sessionId: 'child',
      direction: 'download',
      status: 'ready',
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 60000),
    },
  ]
})

const load = (sessionId: string, userId = 'owner', team = teamId) =>
  loadGroup({ teamId: team, userId, sessionId }, groupId.toHexString())

test('the producing session and its ancestors can read the group', async () => {
  for (const sessionId of ['child', 'parent', 'root']) {
    expect((await load(sessionId))._id.equals(groupId)).toBe(true)
  }
})

test('siblings and unrelated sessions cannot read the group', async () => {
  for (const sessionId of ['sibling', 'unrelated']) {
    await expect(load(sessionId)).rejects.toThrow('File transfer not found')
  }
})

test('a descendant cannot read an ancestor group', async () => {
  collections.file_transfer_groups[0]!.sessionId = 'parent'
  await expect(load('child')).rejects.toThrow('File transfer not found')
})

test("another user's session cannot read the group, even nested under the producer", async () => {
  collections.agent_conversations.push(conversation('foreign', 'child', 'intruder'))
  await expect(load('foreign', 'intruder')).rejects.toThrow('File transfer not found')
})

test("a thread owned by another user does not make the owner's ancestors readers", async () => {
  // Same tree shape, but the middle link belongs to someone else: the walk stops there.
  collections.agent_conversations = [
    conversation('root'),
    conversation('parent', 'root', 'intruder'),
    conversation('child', 'parent'),
  ]
  await expect(load('root')).rejects.toThrow('File transfer not found')
})

test('a session tree in another team cannot read the group', async () => {
  collections.agent_conversations = [
    conversation('root', undefined, 'owner', otherTeamId),
    conversation('parent', 'root', 'owner', otherTeamId),
    conversation('child', 'parent', 'owner', otherTeamId),
  ]
  await expect(load('parent', 'owner', otherTeamId)).rejects.toThrow('File transfer not found')
})
