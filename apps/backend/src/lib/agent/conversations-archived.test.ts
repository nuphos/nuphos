import { beforeEach, describe, expect, test } from 'bun:test'
import { ObjectId } from 'mongodb'

import { useDb } from '@/lib/test/doubles/db'

import { readableByFilter } from './db/access'
import { getConversations, restoreArchivedConversation } from './db'

import type * as dbActual from '@/lib/db'

// Archived reads the viewer's own, then the shared Tasks they archived for themselves.
let queries: Record<string, unknown>[] = []
let sorts: Record<string, number>[] = []
let page: Record<string, unknown>[] = []
let lastUpdate: { filter: unknown; update: unknown } | undefined

const collection = {
  find(query: Record<string, unknown>) {
    queries.push(query)
    const rows = query.userId === VIEWER ? [...page] : []

    return {
      sort: (sort: Record<string, number>) => {
        sorts.push(sort)

        return { limit: () => ({ toArray: () => Promise.resolve(rows) }) }
      },
    }
  },
  findOne: () => Promise.resolve(null),
  updateOne(filter: unknown, update: unknown) {
    lastUpdate = { filter, update }

    return Promise.resolve({ matchedCount: 1, modifiedCount: 1 })
  },
}

useDb({ db: (() => ({ collection: () => collection })) as unknown as typeof dbActual.db })

const TEAM = '64b5f1c2e4b0a1d2c3e4f5a6'
const VIEWER = '642802f4c38340345aa2384d'
// Every list keeps agents and channels apart; see conversations-list-kind.test.ts.
const READABLE = {
  $and: [readableByFilter(VIEWER)],
  kind: { $ne: 'channel' },
  external: { $exists: false },
}

beforeEach(() => {
  queries = []
  sorts = []
  lastUpdate = undefined
  page = []
})

describe('archived conversation listing', () => {
  test('archive sort lists only archived chats, newest-archived first', async () => {
    await getConversations(VIEWER, { teamId: TEAM, sort: 'archived' })

    const shared = `memberArchivedAt.${VIEWER}`

    expect(queries).toEqual([
      {
        teamId: TEAM,
        ...READABLE,
        userId: VIEWER,
        'metadata.trigger.id': { $exists: false },
        archivedAt: { $exists: true },
      },
      {
        teamId: TEAM,
        ...READABLE,
        userId: { $ne: VIEWER },
        participantIds: VIEWER,
        'metadata.trigger.id': { $exists: false },
        archivedAt: { $exists: false },
        [shared]: { $exists: true },
      },
    ])
    expect(sorts).toEqual([
      { archivedAt: -1, _id: -1 },
      { [shared]: -1, _id: -1 },
    ])
  })

  test('the archive cursor pages on archivedAt, then _id', async () => {
    const newest = new Date('2026-09-20T00:00:00Z')
    const id = new ObjectId()

    page = [
      { _id: id, sessionId: 's1', userId: VIEWER, archivedAt: newest },
      {
        _id: new ObjectId(),
        sessionId: 's2',
        userId: VIEWER,
        archivedAt: new Date('2026-09-19T00:00:00Z'),
      },
    ]
    const result = await getConversations(VIEWER, { teamId: TEAM, sort: 'archived', limit: 1 })

    expect(result.hasMore).toBe(true)
    expect(result.nextCursor).toBe(`${newest.toISOString()}_${id.toHexString()}`)

    await getConversations(VIEWER, { teamId: TEAM, sort: 'archived', cursor: result.nextCursor! })
    const shared = `memberArchivedAt.${VIEWER}`

    expect(queries.at(-2)?.archivedAt).toEqual({ $exists: true, $lte: newest })
    expect(queries.at(-2)?.$and).toContainEqual({
      $or: [{ archivedAt: { $lt: newest } }, { _id: { $lt: id } }],
    })
    expect(queries.at(-1)?.[shared]).toEqual({ $exists: true, $lte: newest })
    expect(queries.at(-1)?.$and).toContainEqual({
      $or: [{ [shared]: { $lt: newest } }, { _id: { $lt: id } }],
    })
  })

  test('a time-only cursor from an older client pages strictly before it', async () => {
    const newest = new Date('2026-09-20T00:00:00Z')

    await getConversations(VIEWER, { teamId: TEAM, sort: 'archived', cursor: newest.toISOString() })
    expect(queries.at(-2)?.archivedAt).toEqual({ $exists: true, $lt: newest })
    expect(queries.at(-1)?.[`memberArchivedAt.${VIEWER}`]).toEqual({ $exists: true, $lt: newest })
  })
})

describe('restoreArchivedConversation', () => {
  test('only touches a conversation that is archived, and stamps the restore', async () => {
    expect(await restoreArchivedConversation('sess-1')).toBe(true)
    expect(lastUpdate?.filter).toEqual({ sessionId: 'sess-1', archivedAt: { $exists: true } })
    expect(lastUpdate?.update).toMatchObject({
      $unset: { archivedAt: '' },
      $set: { archiveRestoredAt: expect.any(Date) },
    })
  })
})
