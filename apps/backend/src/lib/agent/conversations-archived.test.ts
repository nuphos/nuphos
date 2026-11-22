import { beforeEach, describe, expect, test } from 'bun:test'

import { useDb } from '@/lib/test/doubles/db'

import { readableByFilter } from './db/access'
import { getConversations, restoreArchivedConversation } from './db'

import type * as dbActual from '@/lib/db'

// Archived reads the viewer's own, then the shared Tasks they archived for themselves.
let queries: Record<string, unknown>[] = []
let sorts: Record<string, number>[] = []
let stages: string[][] = []
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
  // The archive reads through an aggregation, to leave a Bot's work with the Bot.
  aggregate(pipeline: Record<string, Record<string, unknown>>[]) {
    const [{ $match: query }, { $sort: sort }, ...rest] = pipeline as [
      { $match: Record<string, unknown> },
      { $sort: Record<string, number> },
      ...object[],
    ]

    queries.push(query)
    sorts.push(sort)
    stages.push(rest.flatMap((stage) => Object.keys(stage)))

    return { toArray: () => Promise.resolve(query.userId === VIEWER ? [...page] : []) }
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
  stages = []
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
    expect(sorts).toEqual([{ archivedAt: -1 }, { [shared]: -1 }])
    // Both halves leave a Bot's work out before the page is cut (archive-bot-work.mongo.test.ts).
    const botWork = ['$graphLookup', '$match', '$unset', '$limit']

    expect(stages).toEqual([botWork, botWork])
  })

  test('the archive cursor pages on archivedAt', async () => {
    const newest = new Date('2026-09-20T00:00:00Z')

    page = [
      { sessionId: 's1', userId: VIEWER, archivedAt: newest },
      { sessionId: 's2', userId: VIEWER, archivedAt: new Date('2026-09-19T00:00:00Z') },
    ]
    const result = await getConversations(VIEWER, { teamId: TEAM, sort: 'archived', limit: 1 })

    expect(result.hasMore).toBe(true)
    expect(result.nextCursor).toBe(newest.toISOString())

    await getConversations(VIEWER, {
      teamId: TEAM,
      sort: 'archived',
      cursor: newest.toISOString(),
    })
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
