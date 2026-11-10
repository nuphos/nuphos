import { beforeEach, describe, expect, test } from 'bun:test'

import { useDb } from '@/lib/test/doubles/db'
import { useTokenRevocation } from '@/lib/test/doubles/token-revocation'

import { restoreArchivedConversation, setConversationArchived } from './archive'

import type * as dbActual from '@/lib/db'

// The sessions whose tokens each archive revoked.
const revokedSessions: string[][] = []

useTokenRevocation({
  revokeSessionTokens: async (sessionIds) => {
    revokedSessions.push(sessionIds)
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

    // A scalar matches an array holding it, as in Mongo.
    return Array.isArray(actual) ? actual.includes(value) : actual === value
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

    return { modifiedCount: doc ? 1 : 0 }
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
    await new Promise((resolve) => setTimeout(resolve, 2))
    await setConversationArchived('root', true)
    await setConversationArchived('root', false)

    expect(['root', 'child', 'grandchild'].map(archived)).toEqual([false, false, true])
    // The thread that stays archived keeps its revoked tokens revoked.
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

describe('a Bot is archived and restored as one thing with its chat', () => {
  beforeEach(() => {
    conversations.docs.push(
      { sessionId: 'bot', userId: 'u', teamId: 't', avatar: '05-rembrandt' },
      {
        sessionId: 'bot-chat',
        userId: 'u',
        teamId: 't',
        kind: 'channel',
        agentSessionIds: ['bot'],
      },
      {
        sessionId: 'group',
        userId: 'u',
        teamId: 't',
        kind: 'channel',
        agentSessionIds: ['bot'],
        participantIds: ['u', 'v'],
      },
      {
        sessionId: 'two-agents',
        userId: 'u',
        teamId: 't',
        kind: 'channel',
        agentSessionIds: ['bot', 'root'],
      },
      {
        sessionId: 'task-chat',
        userId: 'u',
        teamId: 't',
        kind: 'channel',
        agentSessionIds: ['root'],
      },
    )
  })

  test('archiving the Bot from Tasks archives its chat too, and nothing else', async () => {
    await setConversationArchived('bot', true)

    expect(['bot', 'bot-chat'].map(archived)).toEqual([true, true])
    // A group chat is not the Bot: it stays, as do chats with several agents.
    expect(['group', 'two-agents'].map(archived)).toEqual([false, false])
  })

  test('archiving its only chat archives the Bot', async () => {
    conversations.docs = conversations.docs.filter(
      (doc) => doc.sessionId !== 'group' && doc.sessionId !== 'two-agents',
    )
    await setConversationArchived('bot-chat', true)

    expect(['bot', 'bot-chat'].map(archived)).toEqual([true, true])
  })

  test('restoring either one restores both', async () => {
    for (const id of ['bot', 'bot-chat']) {
      await setConversationArchived('bot', true)
      await setConversationArchived(id, false)

      expect(['bot', 'bot-chat'].map(archived)).toEqual([false, false])
    }
  })

  test('restoring a Bot left half archived brings its chat back too', async () => {
    // Before Bots were one thing, its chat could be archived on its own.
    conversations.docs.find((doc) => doc.sessionId === 'bot-chat')!.archivedAt = new Date(0)
    await setConversationArchived('bot', false)

    expect(archived('bot-chat')).toBe(false)
  })

  test('a turn that brings the Bot back brings its chat back', async () => {
    await setConversationArchived('bot', true)

    expect(await restoreArchivedConversation('bot')).toBe(true)
    expect(['bot', 'bot-chat'].map(archived)).toEqual([false, false])
    expect(await restoreArchivedConversation('bot')).toBe(false)
  })

  test("a Task's chat is just a chat", async () => {
    await setConversationArchived('task-chat', true)

    expect(archived('root')).toBe(false)
  })

  test("another person's Bot is not reached", async () => {
    conversations.docs.find((doc) => doc.sessionId === 'bot')!.userId = 'v'
    await setConversationArchived('bot-chat', true)

    expect(archived('bot')).toBe(false)
  })
})

describe('archiving a redundant Bot chat', () => {
  beforeEach(() => {
    conversations.docs.push(
      { sessionId: 'bot', userId: 'u', teamId: 't', avatar: '05-rembrandt' },
      { sessionId: 'empty', userId: 'u', teamId: 't', kind: 'channel', agentSessionIds: ['bot'] },
      {
        sessionId: 'shared',
        userId: 'u',
        teamId: 't',
        kind: 'channel',
        agentSessionIds: ['bot'],
        participantIds: ['u', 'v'],
      },
      { sessionId: 'work', userId: 'u', teamId: 't', parentSessionId: 'bot' },
    )
  })

  test('keeps the Bot, its work and the shared chat active', async () => {
    await setConversationArchived('empty', true)
    expect(['empty', 'bot', 'shared', 'work'].map(archived)).toEqual([true, false, false, false])
    expect(revokedSessions.at(-1)).toEqual(['empty'])
  })

  test('also protects a Bot with another one-to-one chat', async () => {
    delete conversations.docs.find((doc) => doc.sessionId === 'shared')!.participantIds
    await setConversationArchived('empty', true)
    expect(['empty', 'bot', 'shared'].map(archived)).toEqual([true, false, false])
  })

  test('an archived alternative does not keep the Bot alive', async () => {
    conversations.docs.find((doc) => doc.sessionId === 'shared')!.archivedAt = new Date(0)
    await setConversationArchived('empty', true)
    expect(['empty', 'bot', 'work'].map(archived)).toEqual([true, true, true])
  })
})
