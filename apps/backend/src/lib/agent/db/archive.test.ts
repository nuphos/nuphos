import { beforeEach, describe, expect, test } from 'bun:test'

import { useDb } from '@/lib/test/doubles/db'
import { useTokenRevocation } from '@/lib/test/doubles/token-revocation'

import {
  archiveConversationAs,
  restoreArchivedConversation,
  setConversationArchived,
} from './archive'

import type * as dbActual from '@/lib/db'

const by = { source: 'user', userId: 'u' } as const

// The sessions whose tokens each archive revoked.
const revokedSessions: string[][] = []

useTokenRevocation({
  revokeSessionTokens: async (sessionIds) => {
    revokedSessions.push(sessionIds)
  },
})

type Doc = Record<string, unknown>

type Question = { id: string; about?: string[] }

const questions = (doc: Doc) => (doc.inputRequests ?? []) as Question[]
const isAbout = (question: Question, ids: unknown[]) =>
  Boolean(question.about?.some((ref) => ids.includes(ref)))
const onlyAbout = (question: Question, ids: unknown[]) =>
  Boolean(question.about?.length) && Boolean(question.about?.every((ref) => ids.includes(ref)))

function matches(doc: Doc, filter: Doc): boolean {
  return Object.entries(filter).every(([key, value]) => {
    if (key === '$nor') return !(value as Doc[]).some((one) => matches(doc, one))
    if (key === 'inputRequests.about') {
      return questions(doc).some((question) => isAbout(question, (value as { $in: unknown[] }).$in))
    }
    const actual = doc[key] ?? null

    if (value instanceof Date) return actual instanceof Date && actual.getTime() === value.getTime()
    if (value && typeof value === 'object') {
      const op = value as { $ne?: unknown; $type?: string; $in?: unknown[]; $exists?: boolean }

      if (op.$ne !== undefined) return actual !== op.$ne
      if (op.$type) return typeof actual === op.$type
      if (op.$in) return op.$in.includes(actual)
      if (op.$exists !== undefined) return (actual !== null) === op.$exists
    }

    // A scalar matches an array holding it, as in Mongo.
    return Array.isArray(actual) ? actual.includes(value) : actual === value
  })
}

type Update = {
  $set?: Doc
  $inc?: Doc
  $unset?: Doc
  $pull?: { inputRequests: { about: { $not: { $elemMatch: { $nin: unknown[] } } } } }
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
  private apply(doc: Doc, update: Update | Update[]) {
    if (Array.isArray(update)) {
      const stamp = update[0]?.$set?.archivedAt

      doc.archivedAt = stamp
      doc.archiveTriggersPendingAt = stamp
      doc.triggerArchiveEpoch = Number(doc.triggerArchiveEpoch ?? 0) + 1
      doc.archiveHomePendingEpochs = [
        ...((doc.archiveHomePendingEpochs as unknown[]) ?? []),
        {
          epoch: Number(doc.sessionHomeEpoch ?? 0),
          runtimeId: doc.runtimeId ?? null,
          provider: doc.agentRuntime ?? 'claude-code',
        },
      ]

      return
    }
    Object.assign(doc, update.$set)
    for (const [key, amount] of Object.entries(update.$inc ?? {}))
      doc[key] = Number(doc[key] ?? 0) + Number(amount)
    for (const key of Object.keys(update.$unset ?? {})) delete doc[key]
    const tree = update.$pull?.inputRequests.about.$not.$elemMatch.$nin

    if (tree) doc.inputRequests = questions(doc).filter((question) => !onlyAbout(question, tree))
  }
  async updateOne(filter: Doc, update: Update) {
    this.failIf('updateOne')
    const doc = this.docs.find((d) => matches(d, filter))

    if (doc) this.apply(doc, update)

    return { modifiedCount: doc ? 1 : 0 }
  }
  async updateMany(filter: Doc, update: Update | Update[]) {
    this.failIf('updateMany')
    for (const doc of this.docs.filter((d) => matches(d, filter))) this.apply(doc, update)
  }
}

const conversations = new FakeConversations()

useDb({ db: () => ({ collection: () => conversations }) })

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
    await setConversationArchived('root', true, by)

    expect(['root', 'child', 'grandchild'].map(archived)).toEqual([true, true, true])
    expect(archived('unrelated')).toBe(false)
    // A thread never outlives its parent: every token the tree was issued is revoked.
    expect(revokedSessions.at(-1)?.toSorted()).toEqual(['child', 'grandchild', 'root'])
  })

  // #3470: a question about a thread that was archived waits on nothing.
  test('withdraws the questions asked about a conversation it archives', async () => {
    const root = conversations.docs[0]!

    root.inputRequests = [
      { id: 'about-child', about: ['child'] },
      { id: 'about-pr', about: ['pr-1'] },
      { id: 'about-both', about: ['grandchild', 'pr-1'] },
      { id: 'plain' },
    ]
    conversations.docs.push({
      sessionId: 'teammate-root',
      userId: 'v',
      teamId: 't',
      inputRequests: [{ id: 'theirs', about: ['child'] }],
    })
    await setConversationArchived('child', true, by)

    expect(questions(root).map((question) => question.id)).toEqual([
      'about-pr',
      'about-both',
      'plain',
    ])
    expect(questions(conversations.docs.at(-1)!).map((question) => question.id)).toEqual(['theirs'])
  })

  test("leaves a teammate's conversation alone", async () => {
    await setConversationArchived('root', true, by)

    expect(archived('teammate')).toBe(false)
  })

  test('restores what the cascade archived, not a thread archived on its own earlier', async () => {
    await setConversationArchived('grandchild', true, by)
    await new Promise((resolve) => setTimeout(resolve, 2))
    await setConversationArchived('root', true, by)
    await setConversationArchived('root', false, by)

    expect(['root', 'child', 'grandchild'].map(archived)).toEqual([false, false, true])
    // The thread that stays archived keeps its revoked tokens revoked.
  })

  test('a restore retried after a failed write still restores the tree', async () => {
    for (const method of ['updateMany', 'updateOne'] as const) {
      await setConversationArchived('root', true, by)
      conversations.failNext = method
      await expect(setConversationArchived('root', false, by)).rejects.toThrow('write failed')
      await setConversationArchived('root', false, by)

      expect(['root', 'child', 'grandchild'].map(archived)).toEqual([false, false, false])
    }
  })

  test('stops at a parentSessionId loop', async () => {
    conversations.docs.find((doc) => doc.sessionId === 'root')!.parentSessionId = 'grandchild'
    await setConversationArchived('child', true, by)

    expect(['root', 'child', 'grandchild'].map(archived)).toEqual([true, true, true])
    await setConversationArchived('child', false, by)
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
    // What moved is returned, so a client closes exactly that.
    expect(await setConversationArchived('bot', true, by)).toEqual({
      sessionIds: ['bot', 'bot-chat'],
      botSessionId: 'bot',
    })

    expect(['bot', 'bot-chat'].map(archived)).toEqual([true, true])
    // A group chat is not the Bot: it stays, as do chats with several agents.
    expect(['group', 'two-agents'].map(archived)).toEqual([false, false])
  })

  test('archiving its only chat archives the Bot', async () => {
    conversations.docs = conversations.docs.filter(
      (doc) => doc.sessionId !== 'group' && doc.sessionId !== 'two-agents',
    )
    expect(await setConversationArchived('bot-chat', true, by)).toEqual({
      sessionIds: ['bot', 'bot-chat'],
      botSessionId: 'bot',
    })

    expect(['bot', 'bot-chat'].map(archived)).toEqual([true, true])
  })

  test('restoring either one restores both', async () => {
    for (const id of ['bot', 'bot-chat']) {
      await setConversationArchived('bot', true, by)
      await setConversationArchived(id, false, by)

      expect(['bot', 'bot-chat'].map(archived)).toEqual([false, false])
    }
  })

  test('restoring a Bot left half archived brings its chat back too', async () => {
    // Before Bots were one thing, its chat could be archived on its own.
    conversations.docs.find((doc) => doc.sessionId === 'bot-chat')!.archivedAt = new Date(0)
    await setConversationArchived('bot', false, by)

    expect(archived('bot-chat')).toBe(false)
  })

  test('a turn that brings the Bot back brings its chat back', async () => {
    await setConversationArchived('bot', true, by)

    expect(await restoreArchivedConversation('bot', by)).toBe(true)
    expect(['bot', 'bot-chat'].map(archived)).toEqual([false, false])
    expect(await restoreArchivedConversation('bot', by)).toBe(false)
  })

  test("a Task's chat is just a chat", async () => {
    expect(await setConversationArchived('task-chat', true, by)).toEqual({
      sessionIds: ['task-chat'],
    })

    expect(archived('root')).toBe(false)
  })

  test("another person's Bot is not reached", async () => {
    conversations.docs.find((doc) => doc.sessionId === 'bot')!.userId = 'v'
    await setConversationArchived('bot-chat', true, by)

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
    expect(await setConversationArchived('empty', true, by)).toEqual({ sessionIds: ['empty'] })
    expect(['empty', 'bot', 'shared', 'work'].map(archived)).toEqual([true, false, false, false])
    expect(revokedSessions.at(-1)).toEqual(['empty'])
  })

  test('also protects a Bot with another one-to-one chat', async () => {
    delete conversations.docs.find((doc) => doc.sessionId === 'shared')!.participantIds
    await setConversationArchived('empty', true, by)
    expect(['empty', 'bot', 'shared'].map(archived)).toEqual([true, false, false])
  })

  test('an archived alternative does not keep the Bot alive', async () => {
    conversations.docs.find((doc) => doc.sessionId === 'shared')!.archivedAt = new Date(0)
    await setConversationArchived('empty', true, by)
    expect(['empty', 'bot', 'work'].map(archived)).toEqual([true, true, true])
  })
})

describe('archiveConversationAs', () => {
  const doc = (sessionId: string) => conversations.docs.find((d) => d.sessionId === sessionId)!
  const as = (sessionId: string) => doc(sessionId) as never

  test('the owner archives the conversation with the Tasks below it, then restores it', async () => {
    expect(await archiveConversationAs(as('root'), by, true)).toEqual({ sessionIds: ['root'] })
    expect(['root', 'child', 'grandchild'].map(archived)).toEqual([true, true, true])

    await archiveConversationAs(as('root'), by, false)
    expect(['root', 'child', 'grandchild'].map(archived)).toEqual([false, false, false])
  })

  test('someone else in a Task archives it only for themselves', async () => {
    doc('teammate').participantIds = ['u']

    expect(await archiveConversationAs(as('teammate'), by, true)).toEqual({
      sessionIds: ['teammate'],
    })
    expect(archived('teammate')).toBe(false)
    // The fake applies `$set` keys literally, so the dotted path is one key here.
    expect(doc('teammate')['memberArchivedAt.u']).toBeInstanceOf(Date)
  })

  test('nobody else archives a Task they are not in, or a group chat', async () => {
    expect(await archiveConversationAs(as('teammate'), by, true)).toBeNull()
    Object.assign(doc('teammate'), { participantIds: ['u'], kind: 'channel' })
    expect(await archiveConversationAs(as('teammate'), by, true)).toBeNull()
    expect(archived('teammate')).toBe(false)
    expect(doc('teammate')['memberArchivedAt.u']).toBeUndefined()
  })
})
