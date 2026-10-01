import { beforeEach, describe, expect, test } from 'bun:test'

import { useDb } from '@/lib/test/doubles/db'

import { getConversations, restoreArchivedConversation } from './db'

import type * as dbActual from '@/lib/db'

let lastQuery: Record<string, unknown> | undefined
let lastSort: Record<string, number> | undefined
let page: Record<string, unknown>[] = []
let lastUpdate: { filter: unknown; update: unknown } | undefined

const collection = {
  find(query: Record<string, unknown>) {
    lastQuery = query

    return {
      sort: (sort: Record<string, number>) => {
        lastSort = sort

        return { limit: () => ({ toArray: () => Promise.resolve([...page]) }) }
      },
    }
  },
  updateOne(filter: unknown, update: unknown) {
    lastUpdate = { filter, update }

    return Promise.resolve({ matchedCount: 1, modifiedCount: 1 })
  },
}

useDb({ db: (() => ({ collection: () => collection })) as unknown as typeof dbActual.db })

const TEAM = '69e989027ab63e8d6a0ffcb6'
const VIEWER = '642802f4c38340345aa2384d'

beforeEach(() => {
  lastQuery = undefined
  lastSort = undefined
  lastUpdate = undefined
  page = []
})

describe('archived conversation listing', () => {
  test('archive sort lists only archived chats, newest-archived first', async () => {
    await getConversations(VIEWER, { teamId: TEAM, sort: 'archived' })

    expect(lastQuery).toEqual({
      teamId: TEAM,
      userId: VIEWER,
      'metadata.trigger.id': { $exists: false },
      archivedAt: { $exists: true },
    })
    expect(lastSort).toEqual({ archivedAt: -1 })
  })

  test('the archive cursor pages on archivedAt', async () => {
    const newest = new Date('2026-09-20T00:00:00Z')

    page = [
      { sessionId: 's1', archivedAt: newest },
      { sessionId: 's2', archivedAt: new Date('2026-09-19T00:00:00Z') },
    ]
    const result = await getConversations(VIEWER, { teamId: TEAM, sort: 'archived', limit: 1 })

    expect(result.hasMore).toBe(true)
    expect(result.nextCursor).toBe(newest.toISOString())

    await getConversations(VIEWER, {
      teamId: TEAM,
      sort: 'archived',
      cursor: newest.toISOString(),
    })
    expect(lastQuery?.archivedAt).toEqual({ $exists: true, $lt: newest })
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
