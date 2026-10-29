import { beforeEach, describe, expect, test } from 'bun:test'

import { useDb } from '@/lib/test/doubles/db'

import { getConversations } from './conversations-list'
import { resolvePendingDecision, setPendingDecision } from './pending-decision'

import type * as dbActual from '@/lib/db'

type Doc = Record<string, unknown>

const updates: { filter: Doc; update: Doc }[] = []
let lastQuery: Doc | undefined
// When set, updates apply to these documents the way Mongo would match them.
let stored: Doc[] | null = null

const matches = (doc: Doc, filter: Doc) =>
  Object.entries(filter).every(([key, value]) =>
    key === 'pendingDecision.toolCallId'
      ? (doc.pendingDecision as Doc | undefined)?.toolCallId === value
      : doc[key] === value,
  )

const collection = {
  async updateOne(filter: Doc, update: Doc) {
    updates.push({ filter, update })
    if (!stored) return { matchedCount: 1 }
    const doc = stored.find((candidate) => matches(candidate, filter))

    if (doc && '$unset' in update) delete doc.pendingDecision

    return { matchedCount: doc ? 1 : 0 }
  },
  find(query: Doc) {
    lastQuery = query

    return { sort: () => ({ limit: () => ({ toArray: async () => [] }) }) }
  },
}

useDb({ db: (() => ({ collection: () => collection })) as unknown as typeof dbActual.db })

beforeEach(() => {
  updates.length = 0
  lastQuery = undefined
  stored = null
})

const decision = {
  category: 'approval' as const,
  question: 'Merge #468?',
  options: ['Merge', 'Hold'],
  toolCallId: 'nuphos-1',
  askedAt: new Date('2026-10-19T00:00:00Z'),
}

describe('pending decision', () => {
  test('a question is kept on the owner’s conversation, replacing the one before', async () => {
    await setPendingDecision('s1', 'owner', decision)

    expect(updates).toEqual([
      {
        filter: { sessionId: 's1', userId: 'owner' },
        update: { $set: { pendingDecision: decision } },
      },
    ])
  })

  test('resolving only touches the exact question, preserving any replacement', async () => {
    expect(await resolvePendingDecision('s1', 'owner', 'nuphos-1')).toBe(true)

    expect(updates).toEqual([
      {
        filter: { sessionId: 's1', userId: 'owner', 'pendingDecision.toolCallId': 'nuphos-1' },
        update: { $unset: { pendingDecision: '' } },
      },
    ])
  })

  test("an answer from another owner's record or with an unknown id resolves nothing", async () => {
    const owned = { sessionId: 's1', userId: 'owner', pendingDecision: { toolCallId: 'nuphos-1' } }

    stored = [owned, { sessionId: 's1', userId: 'intruder' }]

    expect(await resolvePendingDecision('s1', 'intruder', 'nuphos-1')).toBe(false)
    expect(await resolvePendingDecision('s1', 'owner', 'nuphos-unknown')).toBe(false)
    expect(owned.pendingDecision).toEqual({ toolCallId: 'nuphos-1' })
    expect(await resolvePendingDecision('s1', 'owner', 'nuphos-1')).toBe(true)
    expect(owned).not.toHaveProperty('pendingDecision')
  })

  test('the Inbox lists waiting conversations, trigger runs included', async () => {
    await getConversations('642802f4c38340345aa2384d', {
      teamId: '64b5f1c2e4b0a1d2c3e4f5a6',
      pendingDecision: true,
      archived: 'exclude',
    })

    expect(lastQuery).toMatchObject({
      pendingDecision: { $exists: true },
      archivedAt: { $exists: false },
    })
    expect(lastQuery).not.toHaveProperty(['metadata.trigger.id'])
  })
})
