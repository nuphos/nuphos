import { expect, test } from 'bun:test'

import { syncConversationTranscriptUnlocked } from './transcript'

import { useDb } from '@/lib/test/doubles/db'

const metadata = {
  version: 1 as const,
  sender: { type: 'user' as const, id: 'alice', displayName: 'Alice' },
  source: 'slack' as const,
  sentAt: '2026-09-27T10:00:00Z',
}
const originalParts = [{ type: 'text', text: 'Check staging only' }]
let writes: { updateOne: { update: { $set: Record<string, unknown> } } }[] = []

useDb({
  db: () => ({
    collection: () => ({
      updateOne: () => Promise.resolve({ upsertedCount: 0 }),
      find: () => ({
        toArray: () =>
          Promise.resolve([
            {
              _id: 'saved',
              messageId: 'old',
              index: 0,
              role: 'user',
              parts: originalParts,
              metadata,
            },
          ]),
      }),
      deleteMany: () => Promise.resolve({ deletedCount: 1 }),
      bulkWrite: (ops: typeof writes) => {
        writes = ops

        return Promise.resolve({})
      },
    }),
  }),
})

test('sync keeps verified author and body by ID after reordering, without attributing legacy text', async () => {
  await syncConversationTranscriptUnlocked({
    sessionId: 'session',
    userId: 'owner',
    title: 'Chat',
    firstMessage: 'hello',
    messages: [
      { id: 'legacy', role: 'user', parts: [{ type: 'text', text: 'unknown author' }] },
      { id: 'old', role: 'assistant', parts: [{ type: 'text', text: 'Delete production' }] },
    ],
  })
  expect(writes[0]!.updateOne.update.$set.metadata).toBeUndefined()
  expect(writes[1]!.updateOne.update.$set).toMatchObject({
    role: 'user',
    parts: originalParts,
    metadata,
  })
})
