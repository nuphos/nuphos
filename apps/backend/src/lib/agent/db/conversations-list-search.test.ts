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

test('search matches a linked PR or issue by its title', async () => {
  await getConversations('viewer', { teamId: 'team', search: 'ink & paper' })
  const pattern = /ink & paper/i

  expect(lastQuery?.$or).toEqual([
    { title: pattern },
    { firstMessage: pattern },
    { 'linkedResources.title': pattern },
  ])
})

test('a PR number, with or without #, finds the conversation it is linked to', async () => {
  for (const search of ['1831', '#1831', ' #1831 ']) {
    await getConversations('viewer', { teamId: 'team', search })
    expect(lastQuery?.$or).toContainEqual({ 'linkedResources.number': 1831 })
  }
})

test('text that is not a bare number never matches PR numbers', async () => {
  await getConversations('viewer', { teamId: 'team', search: 'PR 1831' })
  expect(JSON.stringify(lastQuery?.$or)).not.toContain('linkedResources.number')
})
