import { beforeEach, describe, expect, test } from 'bun:test'

import { useDb } from '@/lib/test/doubles/db'

import { credentialHeirs, credentialSource, credentialSourceOf } from './credential-source'

import type * as dbActual from '@/lib/db'

type Doc = Record<string, unknown>
type Condition = { $ne?: unknown; $in?: unknown[]; $nin?: unknown[]; $exists?: boolean }

function matches(doc: Doc, filter: Doc): boolean {
  return Object.entries(filter).every(([key, want]) => {
    if (key === '$or') return (want as Doc[]).some((one) => matches(doc, one))
    const value = doc[key]

    if (want === null || typeof want !== 'object') return value === want
    const condition = want as Condition

    if ('$ne' in condition) return value !== condition.$ne
    if (condition.$in) return condition.$in.includes(value)
    if (condition.$nin) return !condition.$nin.includes(value)
    if ('$exists' in condition) return (value !== undefined) === condition.$exists

    return false
  })
}

let docs: Doc[] = []

useDb({
  db: (() => ({
    collection: () => ({
      findOne: async (filter: Doc) => docs.find((doc) => matches(doc, filter)) ?? null,
      find: (filter: Doc) => ({ toArray: async () => docs.filter((doc) => matches(doc, filter)) }),
    }),
  })) as unknown as typeof dbActual.db,
})

const bot = { awsRoleIds: ['role-1'], deviceIds: ['mac-mini'] }

beforeEach(() => {
  docs = [
    { sessionId: 'bot', userId: 'u', teamId: 't', title: 'Bot', credentialAccess: bot },
    {
      sessionId: 'task',
      userId: 'u',
      teamId: 't',
      parentSessionId: 'bot',
      credentialAccess: { awsRoleIds: ['stale'] },
    },
    { sessionId: 'subtask', userId: 'u', teamId: 't', parentSessionId: 'task' },
    { sessionId: 'orphan', userId: 'u', teamId: 't', parentSessionId: 'gone' },
    { sessionId: 'theirs', userId: 'v', teamId: 't', parentSessionId: 'bot' },
    { sessionId: 'loop-a', userId: 'u', teamId: 't', parentSessionId: 'loop-b' },
    { sessionId: 'loop-b', userId: 'u', teamId: 't', parentSessionId: 'loop-a' },
    { sessionId: 'chat', userId: 'u', teamId: 't', kind: 'channel' },
    { sessionId: 'in-chat', userId: 'u', teamId: 't', parentSessionId: 'chat' },
  ]
})

const sourceOf = async (sessionId: string) => (await credentialSourceOf(sessionId))?.sessionId

describe('credentialSource', () => {
  test("a Task uses its topmost parent's selection, never its own", async () => {
    expect(await sourceOf('task')).toBe('bot')
    expect(await sourceOf('subtask')).toBe('bot')
    expect((await credentialSourceOf('task'))?.credentialAccess).toEqual(bot as never)
  })

  test('a conversation with no parent uses its own', async () => {
    expect(await sourceOf('bot')).toBe('bot')
    expect(await credentialSourceOf('missing')).toBeNull()
  })

  test("the chain stops at a parent that is gone, someone else's, or a chat", async () => {
    expect(await sourceOf('orphan')).toBe('orphan')
    expect(await sourceOf('theirs')).toBe('theirs')
    expect(await sourceOf('in-chat')).toBe('in-chat')
  })

  test('a cycle ends instead of looping', async () => {
    expect(await sourceOf('loop-a')).toBe('loop-b')
  })

  test('returns the conversation itself when it has no parent', async () => {
    const own = { sessionId: 'bot', userId: 'u', teamId: 't' }

    expect(await credentialSource(own)).toBe(own)
  })
})

describe('credentialHeirs', () => {
  test('lists the conversation and every same-owner Task below it', async () => {
    expect(await credentialHeirs(docs[0] as never)).toEqual(['bot', 'task', 'subtask'])
  })
})
