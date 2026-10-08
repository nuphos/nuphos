import { beforeEach, describe, expect, mock, test } from 'bun:test'

import { useDb } from '@/lib/test/doubles/db'

import {
  getConversationMemoryProvider,
  stampConversationAgentRuntime,
  stampConversationMemoryProvider,
  upsertConversationShell,
} from './db'

import type * as dbActual from '@/lib/db'

// Minimal upsert-capable stand-in. The FakeCollection in memory-native.test.ts
// models neither $setOnInsert nor upsert — exactly what this test exercises.
// Filter matching understands the one operator the stamp path uses:
// { $exists: false }.
class FakeConversations {
  docs: Record<string, unknown>[] = []
  private matches(doc: Record<string, unknown>, filter: Record<string, unknown>): boolean {
    return Object.entries(filter).every(([k, v]) => {
      if (v && typeof v === 'object' && '$exists' in (v as Record<string, unknown>)) {
        return k in doc === (v as { $exists: boolean }).$exists
      }

      return doc[k] === v
    })
  }
  async findOne(filter: Record<string, unknown>) {
    return this.docs.find((d) => this.matches(d, filter)) ?? null
  }
  async updateOne(
    filter: Record<string, unknown>,
    update: { $setOnInsert?: Record<string, unknown>; $set?: Record<string, unknown> },
    opts?: { upsert?: boolean },
  ) {
    const match = this.docs.find((d) => this.matches(d, filter))

    if (match) {
      Object.assign(match, update.$set ?? {}) // existing doc: $setOnInsert must NOT re-fire

      return { upsertedCount: 0 }
    }
    if (opts?.upsert) {
      this.docs.push({ ...(update.$setOnInsert ?? {}), ...(update.$set ?? {}) })

      return { upsertedCount: 1 }
    }

    return { upsertedCount: 0 }
  }
}

const convs = new FakeConversations()

useDb({ db: (() => ({ collection: () => convs })) as unknown as typeof dbActual.db })

describe('upsertConversationShell memoryProvider stamp', () => {
  beforeEach(() => {
    convs.docs = []
  })

  test('stamps memoryProvider:native on insert', async () => {
    const r = await upsertConversationShell({
      sessionId: 's1',
      userId: 'u1',
      title: 'T',
      firstMessage: 'hi',
    })

    expect(r.isNew).toBe(true)
    expect(convs.docs[0]!.memoryProvider).toBe('native')
  })

  test('never overwrites the stamp on a later upsert (immutable)', async () => {
    await upsertConversationShell({ sessionId: 's1', userId: 'u1', title: 'T', firstMessage: 'hi' })
    convs.docs[0]!.memoryProvider = 'xtrace' // if the stamp lived in $set, the next call would reset it
    await upsertConversationShell({
      sessionId: 's1',
      userId: 'u1',
      title: 'T2',
      firstMessage: 'again',
    })
    expect(convs.docs[0]!.memoryProvider).toBe('xtrace')
  })
})

describe('lazy write-once stamp (Phase 2 chat-path swap)', () => {
  beforeEach(() => {
    convs.docs = []
  })

  test('stamps an unstamped legacy doc exactly once', async () => {
    convs.docs.push({ sessionId: 's1', userId: 'u1' }) // pre-stamp legacy doc
    await stampConversationMemoryProvider('s1', 'native')
    expect(convs.docs[0]!.memoryProvider).toBe('native')
  })

  test('the $exists filter is the once-guard: an existing stamp never changes', async () => {
    convs.docs.push({ sessionId: 's1', userId: 'u1', memoryProvider: 'xtrace' })
    await stampConversationMemoryProvider('s1', 'native')
    expect(convs.docs[0]!.memoryProvider).toBe('xtrace')
  })

  test('missing doc is a no-op (never an upsert — the shell upsert owns creation)', async () => {
    await stampConversationMemoryProvider('s-missing', 'native')
    expect(convs.docs).toHaveLength(0)
  })

  test('getConversationMemoryProvider reads the stamp; undefined when absent', async () => {
    convs.docs.push(
      { sessionId: 's1', userId: 'u1', memoryProvider: 'native' },
      { sessionId: 's2', userId: 'u1' },
    )
    expect(await getConversationMemoryProvider('s1')).toBe('native')
    expect(await getConversationMemoryProvider('s2')).toBeUndefined()
    expect(await getConversationMemoryProvider('s-missing')).toBeUndefined()
  })
})

describe('conversation agent runtime stamp', () => {
  beforeEach(() => {
    convs.docs = []
  })

  test('is stamped on insert and cannot be changed by a later upsert', async () => {
    await upsertConversationShell({
      sessionId: 's1',
      userId: 'u1',
      title: 'T',
      firstMessage: 'hi',
      agentRuntime: 'claude-code',
    })
    await upsertConversationShell({
      sessionId: 's1',
      userId: 'u1',
      title: 'T2',
      firstMessage: 'again',
      agentRuntime: 'codex',
    })

    expect(convs.docs[0]!.agentRuntime).toBe('claude-code')
  })

  test('backfills a legacy conversation exactly once', async () => {
    convs.docs.push({ sessionId: 's1', userId: 'u1' })
    await stampConversationAgentRuntime('s1', 'claude-code')
    await stampConversationAgentRuntime('s1', 'codex')

    expect(convs.docs[0]!.agentRuntime).toBe('claude-code')
  })
})

describe('conversation general access stamp', () => {
  beforeEach(() => {
    convs.docs = []
  })

  const shell = (source?: string) => ({
    sessionId: 's1',
    userId: 'u1',
    title: 'T',
    firstMessage: 'hi',
    ...(source ? { source } : {}),
  })

  test('a session started from the app, MCP or a sourceless transcript sync is private', async () => {
    for (const source of ['app', 'mcp', undefined]) {
      convs.docs = []
      await upsertConversationShell(shell(source))
      expect(convs.docs[0]!.generalAccess).toBe('none')
    }
  })

  test('channel and trigger sessions keep the team-wide default', async () => {
    for (const source of ['slack.agent', 'discord.agent', 'lark.agent', 'agent.trigger']) {
      convs.docs = []
      await upsertConversationShell(shell(source))
      expect('generalAccess' in convs.docs[0]!).toBe(false)
    }
  })

  test('the first insert decides; a later turn never re-privatizes a shared session', async () => {
    await upsertConversationShell(shell('app'))
    convs.docs[0]!.generalAccess = 'reply' // the owner opened it to the team
    await upsertConversationShell(shell('app'))
    expect(convs.docs[0]!.generalAccess).toBe('reply')
  })
})
