import { expect, test } from 'bun:test'

import { useDb } from '@/lib/test/doubles/db'

import { getConversations } from './conversations-list'

type Doc = Record<string, unknown>

const queries: Doc[] = []
const rows: Doc[][] = [
  [{ sessionId: 'asking', parentSessionId: 'middle', lastActiveAt: new Date() }],
  [{ sessionId: 'middle', parentSessionId: 'bot', lastActiveAt: new Date() }],
  [{ sessionId: 'bot', lastActiveAt: new Date() }],
]
const collection = {
  find(query: Doc) {
    queries.push(query)
    const found = rows[queries.length - 1] ?? []

    return {
      sort: () => ({ limit: () => ({ toArray: () => Promise.resolve(found) }) }),
      toArray: () => Promise.resolve(found),
    }
  },
}

useDb({ db: () => ({ collection: () => collection }) })

const asksSomething = (query: Doc) => JSON.stringify(query).includes('inputRequests.status')

test('a pending question comes with every conversation above it, questions or not', async () => {
  const result = await getConversations('viewer', {
    teamId: 'team',
    scope: 'mine',
    archived: 'exclude',
    pendingDecision: true,
    withParents: true,
  })

  expect(result.conversations.map((row) => row.sessionId)).toEqual(['asking'])
  expect(result.parents.map((row) => row.sessionId)).toEqual(['middle', 'bot'])
  // The rows are the open questions; their parents are read without that filter,
  // limited as before to the viewer's readable, unarchived conversations.
  expect(asksSomething(queries[0] ?? {})).toBe(true)
  for (const parents of queries.slice(1)) {
    expect(asksSomething(parents)).toBe(false)
    expect(parents).toMatchObject({ teamId: 'team', archivedAt: { $exists: false } })
  }
})
