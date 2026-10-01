import { expect, test } from 'bun:test'

import { attributeAppMessages } from './message-attribution'

import type { UIMessage } from 'ai'

import { useDb } from '@/lib/test/doubles/db'

useDb({
  db: () => ({
    collection: () => ({
      find: () => ({
        toArray: async () => [
          { messageId: 'legacy', role: 'user', parts: [{ type: 'text', text: 'old request' }] },
        ],
      }),
    }),
  }),
})

test('retrying a stored legacy message does not attribute it to the current teammate', async () => {
  const messages: UIMessage[] = [
    { id: 'legacy', role: 'user', parts: [{ type: 'text', text: 'old request' }] },
  ]

  await attributeAppMessages(messages, 'session', 'owner', 'teammate', false)
  expect(messages[0]?.metadata).toEqual({})
})
