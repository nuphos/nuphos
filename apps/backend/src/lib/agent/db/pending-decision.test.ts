import { beforeEach, describe, expect, test } from 'bun:test'

import { useDb } from '@/lib/test/doubles/db'

import { getConversations } from './conversations-list'
import {
  addInputRequest,
  clearPendingDecision,
  legacyPendingDecision,
  openInputRequests,
  resolveInputRequest,
} from './pending-decision'

import type * as dbActual from '@/lib/db'

type Doc = Record<string, unknown>

const updates: { filter: Doc; update: Doc }[] = []
let lastQuery: Doc | undefined
// When set, updates apply to these documents the way Mongo would match them.
let stored: Doc[] | null = null

const elementOf = (doc: Doc, filter: Doc) => {
  const wanted = (filter.inputRequests as { $elemMatch?: Doc } | undefined)?.$elemMatch

  return wanted
    ? ((doc.inputRequests ?? []) as Doc[]).find((entry) =>
        Object.entries(wanted).every(([key, value]) => entry[key] === value),
      )
    : undefined
}
const matches = (doc: Doc, filter: Doc) =>
  Object.entries(filter).every(([key, value]) =>
    key === 'pendingDecision.toolCallId'
      ? (doc.pendingDecision as Doc | undefined)?.toolCallId === value
      : key === 'inputRequests'
        ? elementOf(doc, filter) !== undefined
        : doc[key] === value,
  )

const collection = {
  async updateOne(filter: Doc, update: Doc) {
    updates.push({ filter, update })
    if (!stored) return { matchedCount: 1 }
    const doc = stored.find((candidate) => matches(candidate, filter))

    if (doc && '$unset' in update) delete doc.pendingDecision
    const element = doc && elementOf(doc, filter)
    const status = (update.$set as Doc | undefined)?.['inputRequests.$.status']

    if (element && status) element.status = status

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

const request = {
  id: 'nuphos-1',
  category: 'approval' as const,
  question: 'Merge #468?',
  options: ['Merge', 'Hold'],
  askedAt: new Date('2026-10-19T00:00:00Z'),
}

describe('input requests', () => {
  test('a new question joins the open ones instead of replacing them', async () => {
    await addInputRequest('s1', 'owner', request)

    expect(updates).toEqual([
      {
        filter: { sessionId: 's1', userId: 'owner' },
        update: {
          $push: { inputRequests: { $each: [{ ...request, status: 'open' }], $slice: -100 } },
        },
      },
    ])
  })

  test('resolving marks only the exact open request, or a legacy question with that id', async () => {
    expect(await resolveInputRequest('s1', 'owner', 'nuphos-1', 'dismissed')).toBe(true)

    expect(updates).toEqual([
      {
        filter: {
          sessionId: 's1',
          userId: 'owner',
          inputRequests: { $elemMatch: { id: 'nuphos-1', status: 'open' } },
        },
        update: {
          $set: {
            'inputRequests.$.status': 'dismissed',
            'inputRequests.$.resolvedAt': expect.any(Date),
          },
        },
      },
      {
        filter: { sessionId: 's1', userId: 'owner', 'pendingDecision.toolCallId': 'nuphos-1' },
        update: { $unset: { pendingDecision: '' } },
      },
    ])
  })

  test("an answer from another owner's record or with an unknown id resolves nothing", async () => {
    const open: Doc = { ...request, id: 'nuphos-1', status: 'open' }
    const owned = { sessionId: 's1', userId: 'owner', inputRequests: [open] }

    stored = [owned, { sessionId: 's1', userId: 'intruder' }]

    expect(await resolveInputRequest('s1', 'intruder', 'nuphos-1', 'answered')).toBe(false)
    expect(await resolveInputRequest('s1', 'owner', 'nuphos-unknown', 'answered')).toBe(false)
    expect(open.status).toBe('open')
    expect(await resolveInputRequest('s1', 'owner', 'nuphos-1', 'answered')).toBe(true)
    expect(open.status).toBe('answered')
  })

  test('a legacy channel turn answers every open request', async () => {
    await clearPendingDecision('s1', 'owner')

    expect(updates[0]?.update).toEqual({
      $set: {
        'inputRequests.$[open].status': 'answered',
        'inputRequests.$[open].resolvedAt': expect.any(Date),
      },
    })
    expect(updates[1]).toEqual({
      filter: { sessionId: 's1', userId: 'owner', pendingDecision: { $exists: true } },
      update: { $unset: { pendingDecision: '' } },
    })
  })

  test('open requests include a legacy question once, oldest first', () => {
    const newer = { ...request, id: 'nuphos-2', askedAt: new Date('2026-10-20T00:00:00Z') }
    const answered = { ...request, id: 'nuphos-0', status: 'answered' as const }
    const open = openInputRequests({
      inputRequests: [{ ...newer, status: 'open' }, answered],
      pendingDecision: {
        category: 'approval',
        question: 'Merge #468?',
        toolCallId: 'nuphos-1',
        askedAt: request.askedAt,
      },
    })

    expect(open.map((entry) => entry.id)).toEqual(['nuphos-1', 'nuphos-2'])
    expect(legacyPendingDecision(open)).toEqual({
      category: 'approval',
      question: 'Merge #468?',
      toolCallId: 'nuphos-1',
      askedAt: request.askedAt,
    })
    expect(legacyPendingDecision([])).toBeUndefined()
  })

  test('the Inbox lists conversations with any open request, trigger runs included', async () => {
    await getConversations('642802f4c38340345aa2384d', {
      teamId: '64b5f1c2e4b0a1d2c3e4f5a6',
      pendingDecision: true,
      archived: 'exclude',
      search: 'merge',
    })

    expect(lastQuery).toMatchObject({ archivedAt: { $exists: false } })
    expect(lastQuery?.$and).toContainEqual({
      $or: [{ 'inputRequests.status': 'open' }, { pendingDecision: { $exists: true } }],
    })
    expect(lastQuery).not.toHaveProperty(['metadata.trigger.id'])
  })
})
