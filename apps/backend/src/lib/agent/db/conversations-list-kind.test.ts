import { beforeEach, expect, test } from 'bun:test'

import { useDb } from '@/lib/test/doubles/db'

import { getConversations } from './conversations-list'

import type * as dbActual from '@/lib/db'

type Doc = Record<string, unknown>

let lastQuery: Doc | undefined
const collection = {
  find(query: Doc) {
    lastQuery = query

    return { sort: () => ({ limit: () => ({ toArray: async () => [] }) }) }
  },
}

useDb({ db: (() => ({ collection: () => collection })) as unknown as typeof dbActual.db })

beforeEach(() => {
  lastQuery = undefined
})

test('lists never mix agents and channels: agents by default, channels on request', async () => {
  await getConversations('viewer', { teamId: 'team', search: 'deploy' })
  expect(lastQuery).toMatchObject({ kind: { $ne: 'channel' } })

  await getConversations('viewer', { teamId: 'team', scope: 'shared', channels: true })
  expect(lastQuery).toMatchObject({ kind: 'channel', participantIds: 'viewer' })
})
