import { expect, test } from 'bun:test'

import { useDb } from '@/lib/test/doubles/db'

import { getConversationPreviewAttachment } from './conversations-runtime'

type Doc = Record<string, unknown>
let doc: Doc | null = null

useDb({
  db: () =>
    ({
      collection: () => ({ findOne: async () => doc }),
    }) as unknown as ReturnType<typeof import('@/lib/db').db>,
})

test('a live attachment is returned as stored', async () => {
  doc = { claudeCodePreview: { runtimeUrl: 'wss://a/acp', openabSessionId: 'sess_real' } }

  expect(await getConversationPreviewAttachment('s', 't')).toMatchObject({
    openabSessionId: 'sess_real',
  })
})

test('a legacy forceNew attachment reads as no session at all', async () => {
  // Moves used to mint an openabSessionId the runtime never issued and mark it
  // forceNew. Handing that id to a runtime is a 500, so the store answers null
  // and the next prompt creates a real session.
  doc = {
    claudeCodePreview: {
      runtimeUrl: 'wss://a/acp',
      openabSessionId: 'b1f0c2d3-0000-4000-8000-000000000000',
      forceNew: true,
    },
  }

  expect(await getConversationPreviewAttachment('s', 't')).toBeNull()
})

test('a conversation that never ran has no attachment', async () => {
  doc = {}

  expect(await getConversationPreviewAttachment('s', 't')).toBeNull()
})
