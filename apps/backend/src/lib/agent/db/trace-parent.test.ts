import { beforeEach, expect, test } from 'bun:test'

import { useDb } from '@/lib/test/doubles/db'

import { ensureConversationTraceParent } from './maintenance'

let document: Record<string, unknown>
const writes: { filter: Record<string, unknown>; update: Record<string, unknown> }[] = []

useDb({
  db: () => ({
    collection: () => ({
      findOne: () => Promise.resolve(document),
      findOneAndUpdate: (
        filter: Record<string, unknown>,
        update: { $set: Record<string, unknown> },
      ) => {
        writes.push({ filter, update })
        Object.assign(document, update.$set)

        return Promise.resolve(document)
      },
      updateOne: (filter: Record<string, unknown>, update: { $set: Record<string, unknown> }) => {
        writes.push({ filter, update })
        Object.assign(document, update.$set)

        return Promise.resolve({ matchedCount: 1 })
      },
    }),
  }),
})
beforeEach(() => {
  document = {}
  writes.length = 0
})

test('native root ignores legacy vendor handle without rewriting historical fields', async () => {
  document = { braintrustParent: 'opaque-legacy-handle' }
  const parent = await ensureConversationTraceParent('session', 'user', 'team', () =>
    Promise.resolve('mongo:native-root'),
  )

  expect(parent).toBe('mongo:native-root')
  expect(document.braintrustParent).toBe('opaque-legacy-handle')
  expect(document.conversationTraceParent).toBe(parent)
  expect(writes[0]?.filter).toMatchObject({
    sessionId: 'session',
    userId: 'user',
    conversationTraceParent: { $exists: false },
  })
})

test('existing native conversation parent avoids creating another root', async () => {
  document = { conversationTraceParent: 'mongo:existing-root' }
  let calls = 0
  const parent = await ensureConversationTraceParent('session', 'user', undefined, () => {
    calls++

    return Promise.resolve('unexpected')
  })

  expect(parent).toBe('mongo:existing-root')
  expect(calls).toBe(0)
  expect(writes).toHaveLength(0)
})
