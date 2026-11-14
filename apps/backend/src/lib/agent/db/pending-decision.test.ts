import { beforeEach, describe, expect, test } from 'bun:test'

import { useDb } from '@/lib/test/doubles/db'

import { getConversations } from './conversations-list'
import {
  addInputRequest,
  openInputRequests,
  reopenInputRequest,
  resolveInputRequest,
} from './pending-decision'

import type { InputRequest } from './pending-decision'

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
const has = (doc: Doc, id: unknown): boolean =>
  id && typeof id === 'object' && '$ne' in id
    ? !has(doc, id.$ne)
    : ((doc.inputRequests ?? []) as Doc[]).some((entry) => entry.id === id)
const matches = (doc: Doc, filter: Doc) =>
  Object.entries(filter).every(([key, value]) =>
    key === 'inputRequests'
      ? elementOf(doc, filter) !== undefined
      : key === 'inputRequests.id'
        ? has(doc, value)
        : doc[key] === value,
  )

const collection = {
  async updateOne(filter: Doc, update: Doc) {
    updates.push({ filter, update })
    if (!stored) return { matchedCount: 1 }
    const doc = stored.find((candidate) => matches(candidate, filter))

    const pushed = (update.$push as { inputRequests?: { $each: Doc[] } } | undefined)?.inputRequests
      ?.$each
    const pulled = (update.$pull as { inputRequests?: { id: string } } | undefined)?.inputRequests
      ?.id

    if (doc && pushed) doc.inputRequests = [...((doc.inputRequests ?? []) as Doc[]), ...pushed]
    if (doc && pulled) {
      doc.inputRequests = (doc.inputRequests as Doc[]).filter((entry) => entry.id !== pulled)

      return { matchedCount: 1 }
    }

    return { matchedCount: doc ? 1 : 0 }
  },
  async findOne(filter: Doc) {
    return stored?.find((candidate) => matches(candidate, filter)) ?? null
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
        update: { $push: { inputRequests: { $each: [{ ...request, status: 'open' }] } } },
      },
    ])
  })

  test('open requests are never dropped, however many there are', async () => {
    const owned: Doc = {
      sessionId: 's1',
      userId: 'owner',
      inputRequests: Array.from({ length: 100 }, (_, n) => ({
        ...request,
        id: `nuphos-${String(n)}`,
        status: 'open',
      })),
    }

    stored = [owned]
    await addInputRequest('s1', 'owner', { ...request, id: 'nuphos-new' })

    expect(owned.inputRequests).toHaveLength(101)
    expect(updates.some((update) => '$pull' in update.update)).toBe(false)
  })

  test('resolving takes exactly that request off the list', async () => {
    expect(await resolveInputRequest('s1', 'owner', 'nuphos-1')).toBe(true)

    expect(updates).toEqual([
      {
        filter: { sessionId: 's1', userId: 'owner', 'inputRequests.id': 'nuphos-1' },
        update: { $pull: { inputRequests: { id: 'nuphos-1' } } },
      },
    ])
  })

  test("an answer from another owner's record or with an unknown id resolves nothing", async () => {
    const owned: Doc = {
      sessionId: 's1',
      userId: 'owner',
      inputRequests: [{ ...request, status: 'open' }],
    }

    stored = [owned, { sessionId: 's1', userId: 'intruder' }]

    expect(await resolveInputRequest('s1', 'intruder', 'nuphos-1')).toBe(false)
    expect(await resolveInputRequest('s1', 'owner', 'nuphos-unknown')).toBe(false)
    expect(owned.inputRequests).toHaveLength(1)
    expect(await resolveInputRequest('s1', 'owner', 'nuphos-1')).toBe(true)
    expect(owned.inputRequests).toEqual([])
    expect(await resolveInputRequest('s1', 'owner', 'nuphos-1')).toBe(false)
  })

  test('an answer whose agent could not be told puts the request back once', async () => {
    const owned: Doc = { sessionId: 's1', userId: 'owner', inputRequests: [] }

    stored = [owned]
    await reopenInputRequest('s1', 'owner', { ...request, status: 'open' })

    expect(owned.inputRequests).toEqual([{ ...request, status: 'open' }])
    expect(updates[0]?.filter).toEqual({
      sessionId: 's1',
      userId: 'owner',
      'inputRequests.id': { $ne: 'nuphos-1' },
    })
  })

  test('open requests are the open ones, oldest first', () => {
    const newer = { ...request, id: 'nuphos-2', askedAt: new Date('2026-10-20T00:00:00Z') }
    const older = { ...request, id: 'nuphos-1' }
    // Kept as history before conversations held only open requests.
    const answered = { ...request, id: 'nuphos-0', status: 'answered' } as unknown as InputRequest
    const open = openInputRequests({
      inputRequests: [{ ...newer, status: 'open' }, answered, { ...older, status: 'open' }],
    })

    expect(open.map((entry) => entry.id)).toEqual(['nuphos-1', 'nuphos-2'])
  })

  test('the Inbox lists conversations with any open request, trigger runs included', async () => {
    await getConversations('642802f4c38340345aa2384d', {
      teamId: '64b5f1c2e4b0a1d2c3e4f5a6',
      pendingDecision: true,
      archived: 'exclude',
      search: 'merge',
    })

    expect(lastQuery).toMatchObject({ archivedAt: { $exists: false } })
    expect(lastQuery).not.toHaveProperty(['metadata.trigger.id'])
    expect(lastQuery).not.toHaveProperty('userId')
    expect((lastQuery as { $and: unknown[] }).$and).toContainEqual({
      $or: [
        {
          'inputRequests.status': 'open',
          userId: '642802f4c38340345aa2384d',
        },
        {
          'signInRequest.askedUserIds': '642802f4c38340345aa2384d',
          'signInRequest.askedAt': { $gt: expect.any(Date) },
          $expr: { $eq: ['$signInRequest.runtimeId', '$runtimeId'] },
        },
      ],
    })
  })

  test("the Inbox lists a teammate's conversation that asked the viewer to sign in", async () => {
    await getConversations('642802f4c38340345aa2384d', {
      teamId: '64b5f1c2e4b0a1d2c3e4f5a6',
      pendingDecision: true,
      scope: 'team',
    })
    const and = (lastQuery as { $and: Record<string, unknown>[] }).$and

    // Still only what the viewer may read.
    expect(and[0]).toHaveProperty('$or')
    expect(and[1]).toEqual({
      $or: [
        { 'inputRequests.status': 'open' },
        {
          'signInRequest.askedUserIds': '642802f4c38340345aa2384d',
          'signInRequest.askedAt': { $gt: expect.any(Date) },
          $expr: { $eq: ['$signInRequest.runtimeId', '$runtimeId'] },
        },
      ],
    })
  })

  test('narrowing the team Inbox to one member narrows the sign-in asks too', async () => {
    await getConversations('642802f4c38340345aa2384d', {
      teamId: '64b5f1c2e4b0a1d2c3e4f5a6',
      pendingDecision: true,
      scope: 'team',
      ownerId: 'member-1',
    })
    const and = (lastQuery as { $and: Record<string, unknown>[] }).$and

    expect(and[1]).toMatchObject({
      $or: [
        {
          'inputRequests.status': 'open',
          userId: 'member-1',
        },
        { userId: 'member-1', 'signInRequest.askedUserIds': '642802f4c38340345aa2384d' },
      ],
    })
  })
})
