import { expect, test } from 'bun:test'

import { useDb } from '@/lib/test/doubles/db'

import { setupTraceIndexes } from './store'

const indexes: string[] = []

useDb({
  db: () => ({
    collection: (name: string) => ({
      createIndex: async () => {
        indexes.push(name)
      },
    }),
  }),
})

test('startup initializes Mongo trace indexes without local storage configuration', async () => {
  await setupTraceIndexes()
  expect(indexes.filter((name) => name === 'agent_trace_events')).toHaveLength(5)
  expect(indexes.filter((name) => name === 'agent_trace_payloads')).toHaveLength(2)
})
