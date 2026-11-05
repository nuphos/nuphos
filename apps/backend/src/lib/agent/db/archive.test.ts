import { beforeEach, describe, expect, test } from 'bun:test'

import { useDb } from '@/lib/test/doubles/db'
import { useTokenRevocation } from '@/lib/test/doubles/token-revocation'

import { setConversationArchived } from './archive'

import type * as dbActual from '@/lib/db'

// The sessions whose tokens each archive revoked.
const revokedSessions: string[][] = []
const releasedSessions: string[][] = []
let lastGenerations: Record<string, number> = {}

useTokenRevocation({
  revokeSessionTokens: async (sessionIds, _reason, generations) => {
    revokedSessions.push(sessionIds)
    lastGenerations = generations ?? {}
  },
  releaseRestoredSessions: async (sessionIds) => {
    releasedSessions.push(sessionIds)
  },
})

type Doc = Record<string, unknown>

function matches(doc: Doc, filter: Doc): boolean {
  return Object.entries(filter).every(([key, value]) => {
    const actual = doc[key] ?? null

    if (value instanceof Date) return actual instanceof Date && actual.getTime() === value.getTime()
    if (value && typeof value === 'object') {
      const op = value as { $in?: unknown[]; $exists?: boolean }

      if (op.$in) return op.$in.includes(actual)
      if (op.$exists !== undefined) return (actual !== null) === op.$exists
    }

    return actual === value
  })
}

class FakeConversations {
  docs: Doc[] = []
  failNext: 'updateOne' | 'updateMany' | null = null
  private failIf(method: 'updateOne' | 'updateMany') {
    if (this.failNext !== method) return
    this.failNext = null
    throw new Error('write failed')
  }
  async findOne(filter: Doc) {
    const doc = this.docs.find((d) => matches(d, filter))

    return doc ? { ...doc } : null
  }
  find(filter: Doc) {
    return { toArray: async () => this.docs.filter((doc) => matches(doc, filter)) }
  }
  private apply(doc: Doc, update: { $set?: Doc; $unset?: Doc }) {
    Object.assign(doc, update.$set)
    for (const key of Object.keys(update.$unset ?? {})) delete doc[key]
  }
  async updateOne(filter: Doc, update: { $set?: Doc; $unset?: Doc }) {
    this.failIf('updateOne')
    const doc = this.docs.find((d) => matches(d, filter))

    if (doc) this.apply(doc, update)
  }
  async updateMany(filter: Doc, update: { $set?: Doc; $unset?: Doc }) {
    this.failIf('updateMany')
    for (const doc of this.docs.filter((d) => matches(d, filter))) this.apply(doc, update)
  }
}

const conversations = new FakeConversations()

useDb({ db: (() => ({ collection: () => conversations })) as unknown as typeof dbActual.db })

const archived = (sessionId: string) =>
  Boolean(conversations.docs.find((doc) => doc.sessionId === sessionId)?.archivedAt)

beforeEach(() => {
  conversations.docs = [
    { sessionId: 'root', userId: 'u', teamId: 't' },
    { sessionId: 'child', userId: 'u', teamId: 't', parentSessionId: 'root' },
    { sessionId: 'grandchild', userId: 'u', teamId: 't', parentSessionId: 'child' },
    { sessionId: 'teammate', userId: 'v', teamId: 't', parentSessionId: 'root' },
    { sessionId: 'unrelated', userId: 'u', teamId: 't' },
  ]
})

describe('setConversationArchived', () => {
  test('archives the whole tree below the conversation', async () => {
    await setConversationArchived('root', true)

    expect(['root', 'child', 'grandchild'].map(archived)).toEqual([true, true, true])
    expect(archived('unrelated')).toBe(false)
    // A thread never outlives its parent: every token the tree was issued is revoked.
    expect(revokedSessions.at(-1)?.toSorted()).toEqual(['child', 'grandchild', 'root'])
  })

  test("leaves a teammate's conversation alone", async () => {
    await setConversationArchived('root', true)

    expect(archived('teammate')).toBe(false)
  })

  test('restores what the cascade archived, not a thread archived on its own earlier', async () => {
    await setConversationArchived('grandchild', true)
    const grandchildGeneration = lastGenerations.grandchild

    await new Promise((resolve) => setTimeout(resolve, 2))
    await setConversationArchived('root', true)
    // The thread archived on its own keeps its own generation; the cascade stamps the rest.
    expect(lastGenerations.grandchild).toBe(grandchildGeneration)
    expect(lastGenerations.child).toBe(lastGenerations.root)
    expect(lastGenerations.root).toBeGreaterThan(grandchildGeneration!)
    await setConversationArchived('root', false)

    expect(['root', 'child', 'grandchild'].map(archived)).toEqual([false, false, true])
    // The thread that stays archived keeps its revoked tokens revoked.
    expect(releasedSessions.at(-1)?.toSorted()).toEqual(['child', 'root'])
  })

  test('a restore retried after a failed write still restores the tree', async () => {
    for (const method of ['updateMany', 'updateOne'] as const) {
      await setConversationArchived('root', true)
      conversations.failNext = method
      await expect(setConversationArchived('root', false)).rejects.toThrow('write failed')
      await setConversationArchived('root', false)

      expect(['root', 'child', 'grandchild'].map(archived)).toEqual([false, false, false])
    }
  })

  test('stops at a parentSessionId loop', async () => {
    conversations.docs.find((doc) => doc.sessionId === 'root')!.parentSessionId = 'grandchild'
    await setConversationArchived('child', true)

    expect(['root', 'child', 'grandchild'].map(archived)).toEqual([true, true, true])
    await setConversationArchived('child', false)
    expect(['root', 'child', 'grandchild'].map(archived)).toEqual([false, false, false])
  })
})
