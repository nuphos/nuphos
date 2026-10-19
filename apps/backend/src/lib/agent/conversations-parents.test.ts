import { beforeEach, describe, expect, test } from 'bun:test'

import { useDb } from '@/lib/test/doubles/db'

import { readableByFilter } from './db/access'
import { getConversations } from './db'

import type * as dbActual from '@/lib/db'

// A paging client nests a thread under its parent only when the parent is
// listed. Without `parents`, a thread whose parent sat on a later page was
// listed on its own until the user scrolled that far.

type Row = { sessionId: string; parentSessionId?: string }

let page: Row[] = []
let stored: Row[] = []
let parentQueries: Record<string, unknown>[] = []

const collection = {
  find(query: Record<string, unknown>) {
    const ids = (query.sessionId as { $in?: string[] } | undefined)?.$in

    if (ids) {
      parentQueries.push(query)

      return { toArray: () => Promise.resolve(stored.filter((row) => ids.includes(row.sessionId))) }
    }

    return { sort: () => ({ limit: () => ({ toArray: () => Promise.resolve([...page]) }) }) }
  },
}

useDb({ db: (() => ({ collection: () => collection })) as unknown as typeof dbActual.db })

const TEAM = '64b5f1c2e4b0a1d2c3e4f5a6'
const VIEWER = '642802f4c38340345aa2384d'

beforeEach(() => {
  page = []
  stored = []
  parentQueries = []
})

describe('getConversations withParents', () => {
  test('returns the ancestors missing from the page, once each', async () => {
    page = [
      { sessionId: 'thread-a', parentSessionId: 'parent' },
      { sessionId: 'thread-b', parentSessionId: 'parent' },
      { sessionId: 'listed' },
      { sessionId: 'thread-c', parentSessionId: 'listed' },
    ]
    stored = [{ sessionId: 'parent', parentSessionId: 'grandparent' }, { sessionId: 'grandparent' }]
    const result = await getConversations(VIEWER, { teamId: TEAM, withParents: true })

    expect(result.parents.map((row) => row.sessionId)).toEqual(['parent', 'grandparent'])
    expect(parentQueries.map((query) => query.sessionId)).toEqual([
      { $in: ['parent'] },
      { $in: ['grandparent'] },
    ])
  })

  test('uses the listing filters without the cursor, across own and shared chats', async () => {
    page = [{ sessionId: 'thread', parentSessionId: 'parent' }]
    await getConversations(VIEWER, {
      teamId: TEAM,
      scope: 'shared',
      archived: 'exclude',
      search: 'deploy',
      cursor: '2026-10-01T00:00:00.000Z',
      withParents: true,
    })
    const [query] = parentQueries

    expect(query).toMatchObject({
      teamId: TEAM,
      archivedAt: { $exists: false },
      $or: [{ title: /deploy/i }, { firstMessage: /deploy/i }],
    })
    expect(query).not.toHaveProperty('userId')
    expect(query).not.toHaveProperty('participantIds')
    expect(query).not.toHaveProperty('lastActiveAt')
    expect(query?.$and).toContainEqual(readableByFilter(VIEWER))
    expect(query?.$and).toContainEqual({ $or: [{ userId: VIEWER }, { participantIds: VIEWER }] })
  })

  // The lookup must never return a parent the viewer could not list: the
  // readability clause stays in every scope, including team scope, which
  // keeps the listing's `$and` as it is.
  for (const scope of ['mine', 'team'] as const) {
    test(`keeps the readability filter in ${scope} scope`, async () => {
      page = [{ sessionId: 'thread', parentSessionId: 'parent' }]
      await getConversations(VIEWER, { teamId: TEAM, scope, withParents: true })
      const [query] = parentQueries

      expect(query?.teamId).toBe(TEAM)
      expect(query?.$and).toContainEqual(readableByFilter(VIEWER))
      if (scope === 'team') expect(query?.$and).toEqual([readableByFilter(VIEWER)])
    })
  }

  test('a parent the listing excludes is not returned, so the thread stays top-level', async () => {
    page = [{ sessionId: 'thread', parentSessionId: 'archived-parent' }]
    const result = await getConversations(VIEWER, { teamId: TEAM, withParents: true })

    expect(result.parents).toEqual([])
  })

  test('other callers do not pay for the lookup', async () => {
    page = [{ sessionId: 'thread', parentSessionId: 'parent' }]
    const result = await getConversations(VIEWER, { teamId: TEAM })

    expect(result.parents).toEqual([])
    expect(parentQueries).toEqual([])
  })
})
