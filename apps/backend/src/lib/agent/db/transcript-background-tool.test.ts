import { beforeEach, expect, test } from 'bun:test'
import { useDb } from '@/lib/test/doubles/db'
import { updateBackgroundToolResult } from './transcript-background-tool'

let exists = true
let filters: unknown[] = []
let writes: { collection: string; filter: unknown; update: unknown; options: unknown }[] = []

useDb({
  db: () =>
    ({
      collection: (collection: string) => ({
        findOne: async (filter: unknown) => {
          filters.push(filter)

          return exists ? { _id: 'conversation' } : null
        },
        updateMany: async (filter: unknown, update: unknown, options: unknown) => {
          writes.push({ collection, filter, update, options })

          return { modifiedCount: 1 }
        },
        updateOne: async (filter: unknown, update: unknown) => {
          writes.push({ collection, filter, update, options: undefined })

          return { modifiedCount: 1 }
        },
      }),
    }) as never,
})
beforeEach(() => {
  exists = true
  filters = []
  writes = []
})
const result = {
  sessionId: 'session',
  userId: 'owner',
  teamId: 'team',
  toolCallId: 'original-command',
  state: 'output-error' as const,
  errorText: 'exit 1',
}

test('updates only the original tool and transcript revision, never execution state or message count', async () => {
  await updateBackgroundToolResult(result)
  expect(filters).toEqual([
    {
      sessionId: 'session',
      userId: 'owner',
      $or: [{ teamId: 'team' }, { teamId: { $exists: false } }],
    },
  ])
  expect(writes).toHaveLength(2)
  expect(writes[0]).toMatchObject({
    collection: 'agent_messages',
    filter: { sessionId: 'session', userId: 'owner', 'parts.toolCallId': 'original-command' },
    update: {
      $set: { 'parts.$[tool].state': 'output-error', 'parts.$[tool].runtimeResult': true },
    },
    options: { arrayFilters: [{ 'tool.toolCallId': 'original-command' }] },
  })
  expect(Object.keys((writes[1]!.update as { $set: object }).$set)).toEqual(['transcriptUpdatedAt'])
})

test('does not write a result into a conversation outside the authorized team', async () => {
  exists = false
  await updateBackgroundToolResult(result)
  expect(writes).toEqual([])
})
