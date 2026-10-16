import { beforeEach, describe, expect, test } from 'bun:test'

import { useDb } from '@/lib/test/doubles/db'

import { setConversationArchived } from './archive'

import type * as dbActual from '@/lib/db'

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
    const doc = this.docs.find((d) => matches(d, filter))

    if (doc) this.apply(doc, update)
  }
  async updateMany(filter: Doc, update: { $set?: Doc; $unset?: Doc }) {
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
  })

  test("leaves a teammate's conversation alone", async () => {
    await setConversationArchived('root', true)

    expect(archived('teammate')).toBe(false)
  })

  test('restores what the cascade archived, not a thread archived on its own earlier', async () => {
    await setConversationArchived('grandchild', true)
    await new Promise((resolve) => setTimeout(resolve, 2))
    await setConversationArchived('root', true)
    await setConversationArchived('root', false)

    expect(['root', 'child', 'grandchild'].map(archived)).toEqual([false, false, true])
  })

  test('stops at a parentSessionId loop', async () => {
    conversations.docs.find((doc) => doc.sessionId === 'root')!.parentSessionId = 'grandchild'
    await setConversationArchived('child', true)

    expect(['root', 'child', 'grandchild'].map(archived)).toEqual([true, true, true])
    await setConversationArchived('child', false)
    expect(['root', 'child', 'grandchild'].map(archived)).toEqual([false, false, false])
  })
})
