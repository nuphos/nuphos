import { beforeEach, expect, test } from 'bun:test'

import { useDb } from '@/lib/test/doubles/db'

import { backfillThreadCreators } from './maintenance'

type Doc = Record<string, unknown>
let docs: Doc[] = []

// Enough of Mongo for this filter: plain equality and { $exists }.
function matches(doc: Doc, filter: Doc) {
  return Object.entries(filter).every(([key, want]) => {
    const value = key.split('.').reduce<unknown>((at, part) => (at as Doc | undefined)?.[part], doc)

    return want && typeof want === 'object' && '$exists' in want
      ? (value !== undefined) === (want as { $exists: boolean }).$exists
      : value === want
  })
}

useDb({
  db: () => ({
    collection: () => ({
      find: (filter: Doc) => ({ toArray: async () => docs.filter((doc) => matches(doc, filter)) }),
      updateOne: async (filter: Doc, update: { $set: Doc }) => {
        const doc = docs.find((candidate) => matches(candidate, filter))

        if (doc) Object.assign(doc, update.$set)

        return { matchedCount: doc ? 1 : 0 }
      },
    }),
  }),
})
beforeEach(() => {
  docs = [
    { sessionId: 'old', parentSessionId: 'manager', metadata: { source: 'agent.thread' } },
    {
      sessionId: 'new',
      parentSessionId: 'manager',
      createdBySessionId: 'manager',
      metadata: { source: 'agent.thread' },
    },
    { sessionId: 'unlinked', metadata: { source: 'agent.thread' } },
    { sessionId: 'chat', parentSessionId: 'other', metadata: { source: 'nuphos' } },
  ]
})

test('records the opener of threads created before it was stored, once', async () => {
  expect(await backfillThreadCreators()).toBe(1)
  expect(docs.map((doc) => [doc.sessionId, doc.createdBySessionId])).toEqual([
    ['old', 'manager'],
    ['new', 'manager'],
    ['unlinked', undefined],
    ['chat', undefined],
  ])
  expect(await backfillThreadCreators()).toBe(0)
})
