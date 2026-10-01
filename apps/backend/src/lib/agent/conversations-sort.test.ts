import { describe, expect, test } from 'bun:test'

import { useDb } from '@/lib/test/doubles/db'

import { getConversations } from './db'

import type * as dbActual from '@/lib/db'

let lastQuery: Record<string, unknown> | undefined
let lastSort: Record<string, number> | undefined

const collection = {
  find(query: Record<string, unknown>) {
    lastQuery = query

    return {
      sort(sort: Record<string, number>) {
        lastSort = sort

        return { limit: () => ({ toArray: async () => [] }) }
      },
    }
  },
}

useDb({ db: (() => ({ collection: () => collection })) as unknown as typeof dbActual.db })

const TEAM = '69e989027ab63e8d6a0ffcb6'
const VIEWER = '642802f4c38340345aa2384d'
const CURSOR = '2026-09-13T08:00:00.000Z'

describe('getConversations sorting', () => {
  test('defaults to newest activity', async () => {
    await getConversations(VIEWER, { teamId: TEAM, cursor: CURSOR })

    expect(lastSort).toEqual({ lastActiveAt: -1 })
    expect(lastQuery?.lastActiveAt).toEqual({ $lt: new Date(CURSOR) })
  })

  test('can keep the sidebar stable by creation time', async () => {
    await getConversations(VIEWER, { teamId: TEAM, cursor: CURSOR, sort: 'created' })

    expect(lastSort).toEqual({ createdAt: -1 })
    expect(lastQuery?.createdAt).toEqual({ $lt: new Date(CURSOR) })
    expect(lastQuery?.lastActiveAt).toBeUndefined()
  })
})
