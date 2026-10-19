import { beforeEach, describe, expect, test } from 'bun:test'

import { useDb } from '@/lib/test/doubles/db'

import { upsertConversationShell } from './conversations'
import { backfillConversationWatchers, initialWatcherIds, setConversationWatched } from './watch'

import type * as dbActual from '@/lib/db'

type Doc = Record<string, unknown>
type Update = {
  $set?: Doc
  $setOnInsert?: Doc
  $addToSet?: Record<string, string>
  $pull?: Record<string, string>
}

function field(doc: Doc, path: string): unknown {
  return path.split('.').reduce<unknown>((value, key) => (value as Doc | undefined)?.[key], doc)
}

function matches(doc: Doc, filter: Doc): boolean {
  return Object.entries(filter).every(([key, value]) => {
    const actual = field(doc, key)

    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const op = value as { $in?: unknown[]; $exists?: boolean; $not?: RegExp }

      if (op.$in) return op.$in.includes(actual)
      if (op.$exists !== undefined) return (actual !== undefined) === op.$exists
      if (op.$not) return typeof actual !== 'string' || !op.$not.test(actual)
    }

    return actual === value
  })
}

class FakeConversations {
  docs: Doc[] = []
  private apply(doc: Doc, update: Update | Doc[]) {
    if (Array.isArray(update)) {
      // Only the backfill's `[{ $set: { watcherIds: ['$userId'] } }]` pipeline.
      doc.watcherIds = [doc.userId]

      return
    }
    Object.assign(doc, update.$set)
    for (const [key, id] of Object.entries(update.$addToSet ?? {})) {
      const list = (doc[key] as string[] | undefined) ?? []

      doc[key] = list.includes(id) ? list : [...list, id]
    }
    for (const [key, id] of Object.entries(update.$pull ?? {})) {
      doc[key] = ((doc[key] as string[] | undefined) ?? []).filter((item) => item !== id)
    }
  }
  find(filter: Doc) {
    return { toArray: async () => this.docs.filter((doc) => matches(doc, filter)) }
  }
  async updateOne(filter: Doc, update: Update, options?: { upsert?: boolean }) {
    const doc = this.docs.find((d) => matches(d, filter))

    if (doc) {
      this.apply(doc, update)

      return { upsertedCount: 0, modifiedCount: 1 }
    }
    if (!options?.upsert) return { upsertedCount: 0, modifiedCount: 0 }
    this.docs.push({ ...filter, ...update.$setOnInsert, ...update.$set })

    return { upsertedCount: 1, modifiedCount: 0 }
  }
  async updateMany(filter: Doc, update: Update | Doc[]) {
    const hits = this.docs.filter((d) => matches(d, filter))

    for (const doc of hits) this.apply(doc, update)

    return { modifiedCount: hits.length }
  }
}

const conversations = new FakeConversations()

useDb({ db: (() => ({ collection: () => conversations })) as unknown as typeof dbActual.db })

const watchersOf = (sessionId: string) =>
  conversations.docs.find((doc) => doc.sessionId === sessionId)?.watcherIds

function open(sessionId: string, extra: { source?: string; parentSessionId?: string } = {}) {
  return upsertConversationShell({
    sessionId,
    userId: 'u',
    teamId: 't',
    title: 'x',
    firstMessage: 'x',
    ...extra,
  })
}

beforeEach(() => {
  conversations.docs = []
})

describe('initialWatcherIds', () => {
  test('a conversation opened by hand is watched by its opener', () => {
    expect(initialWatcherIds('u', { source: 'app' })).toEqual(['u'])
    expect(initialWatcherIds('u', {})).toEqual(['u'])
  })

  test('agent, trigger and channel conversations start unwatched', () => {
    for (const source of [
      'agent.thread',
      'agent.trigger',
      'slack.agent',
      'discord.agent',
      'lark.agent',
      'mcp',
    ]) {
      expect(initialWatcherIds('u', { source })).toEqual([])
    }
    expect(initialWatcherIds('u', { parentSessionId: 'p' })).toEqual([])
    expect(initialWatcherIds('u', { source: 'app', trigger: { id: 'tr' } })).toEqual([])
  })
})

describe('setConversationWatched', () => {
  beforeEach(async () => {
    await open('root', { source: 'app' })
    await open('child', { source: 'agent.thread', parentSessionId: 'root' })
    await open('grandchild', { source: 'agent.thread', parentSessionId: 'child' })
    await setConversationWatched('child', 't', 'u', true)
    await setConversationWatched('grandchild', 't', 'u', true)
    await setConversationWatched('root', 't', 'teammate', true)
  })

  test('unwatching cascades to every descendant and leaves teammates alone', async () => {
    await setConversationWatched('root', 't', 'u', false)

    expect(watchersOf('root')).toEqual(['teammate'])
    expect(watchersOf('child')).toEqual([])
    expect(watchersOf('grandchild')).toEqual([])
  })

  test('a sub-agent created after the unwatch stays unwatched', async () => {
    await setConversationWatched('root', 't', 'u', false)
    await open('later', { source: 'agent.thread', parentSessionId: 'root' })

    expect(watchersOf('later')).toEqual([])
  })

  test('watching adds only the conversation itself, once', async () => {
    await setConversationWatched('root', 't', 'u', false)
    await setConversationWatched('root', 't', 'u', true)
    await setConversationWatched('root', 't', 'u', true)

    expect(watchersOf('root')).toEqual(['teammate', 'u'])
    expect(watchersOf('child')).toEqual([])
  })
})

test('the backfill gives existing conversations the default a new one would get', async () => {
  conversations.docs = [
    { sessionId: 'mine', userId: 'u', metadata: { source: 'app' } },
    { sessionId: 'legacy', userId: 'u', metadata: {} },
    {
      sessionId: 'thread',
      userId: 'u',
      parentSessionId: 'mine',
      metadata: { source: 'agent.thread' },
    },
    { sessionId: 'run', userId: 'u', metadata: { source: 'agent.trigger', trigger: { id: 'tr' } } },
    { sessionId: 'slack', userId: 'u', metadata: { source: 'slack.agent' } },
    { sessionId: 'done', userId: 'u', watcherIds: [] },
  ]

  expect(await backfillConversationWatchers()).toBe(5)
  expect(conversations.docs.map((doc) => [doc.sessionId, doc.watcherIds])).toEqual([
    ['mine', ['u']],
    ['legacy', ['u']],
    ['thread', []],
    ['run', []],
    ['slack', []],
    ['done', []],
  ])
  expect(await backfillConversationWatchers()).toBe(0)
})
