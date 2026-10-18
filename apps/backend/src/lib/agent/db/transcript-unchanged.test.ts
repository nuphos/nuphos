import { expect, test } from 'bun:test'

import { useDb } from '@/lib/test/doubles/db'

import { syncConversationTranscriptUnlocked } from './transcript'

const stored = [
  { _id: 'a', messageId: 'm0', index: 0, role: 'user', parts: [{ type: 'text', text: 'hi' }] },
  {
    _id: 'b',
    messageId: 'm1',
    index: 1,
    role: 'assistant',
    // Stored the way the driver writes an explicitly undefined field.
    parts: [{ type: 'text', text: 'hello', providerMetadata: null }],
  },
]

type Write = { updateOne: { filter: { index: number } } }
const seen: { writes?: Write[] } = {}
const writtenIndexes = () => seen.writes?.map((op) => op.updateOne.filter.index)

useDb({
  db: () => ({
    collection: () => ({
      updateOne: () => Promise.resolve({ upsertedCount: 0 }),
      find: () => ({ toArray: () => Promise.resolve(stored) }),
      deleteMany: () => Promise.resolve({ deletedCount: 0 }),
      bulkWrite: (ops: Write[]) => {
        seen.writes = ops

        return Promise.resolve({})
      },
    }),
  }),
})

const sync = (messages: { id: string; role: 'user' | 'assistant'; parts: unknown[] }[]) =>
  syncConversationTranscriptUnlocked({
    sessionId: 'session',
    userId: 'owner',
    title: 'Chat',
    firstMessage: 'hi',
    messages,
  })

test('a new turn writes only the message the store does not already hold', async () => {
  seen.writes = undefined
  await sync([
    { id: 'm0', role: 'user', parts: [{ type: 'text', text: 'hi' }] },
    {
      id: 'm1',
      role: 'assistant',
      parts: [{ type: 'text', text: 'hello', providerMetadata: undefined }],
    },
    { id: 'm2', role: 'user', parts: [{ type: 'text', text: 'next' }] },
  ])
  expect(writtenIndexes()).toEqual([2])
})

test('a changed stored message is still rewritten', async () => {
  seen.writes = undefined
  await sync([
    { id: 'm0', role: 'user', parts: [{ type: 'text', text: 'hi' }] },
    { id: 'm1', role: 'assistant', parts: [{ type: 'text', text: 'hello, edited' }] },
  ])
  expect(writtenIndexes()).toEqual([1])
})

test('an unchanged transcript issues no write at all', async () => {
  seen.writes = undefined
  await sync([
    { id: 'm0', role: 'user', parts: [{ type: 'text', text: 'hi' }] },
    {
      id: 'm1',
      role: 'assistant',
      parts: [{ type: 'text', text: 'hello', providerMetadata: null }],
    },
  ])
  expect(writtenIndexes()).toBeUndefined()
})
