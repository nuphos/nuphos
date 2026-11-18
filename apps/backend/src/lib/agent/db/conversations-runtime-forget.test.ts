import { beforeEach, expect, test } from 'bun:test'

import { useDb } from '@/lib/test/doubles/db'

import { forgetConversationPreviewSession } from './conversations-runtime'

const updates: unknown[][] = []

useDb({
  db: () => ({
    collection: () => ({
      updateOne: async (...args: unknown[]) => {
        updates.push(args)

        return { matchedCount: 1 }
      },
    }),
  }),
})
beforeEach(() => {
  updates.length = 0
})

const filter = { sessionId: 'c', teamId: 't', 'claudeCodePreview.openabSessionId': 's' }

test('forgetting a session keeps the model pick it ran with', async () => {
  await forgetConversationPreviewSession('c', 't', 's', { model: 'opus' })

  expect(updates).toEqual([
    [
      filter,
      { $unset: { claudeCodePreview: '' }, $set: { initialSessionConfig: { model: 'opus' } } },
    ],
  ])
})

// No pick to carry over must not erase the conversation's stored one.
test('forgetting with an empty pick leaves the stored pick', async () => {
  await forgetConversationPreviewSession('c', 't', 's', {})

  expect(updates).toEqual([[filter, { $unset: { claudeCodePreview: '' } }]])
})
