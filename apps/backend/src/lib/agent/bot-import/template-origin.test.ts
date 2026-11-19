import { expect, test } from 'bun:test'

import { useDb } from '@/lib/test/doubles/db'

import { newImportBatch } from './batch'
import { botBundleSchema } from './manifest'
import { saveTemplateOrigin } from './template-origin'

const writes: { filter: unknown; update: unknown }[] = []
let matched = 1

useDb({
  db: () => ({
    collection: () => ({
      updateOne: async (filter: unknown, update: unknown) => {
        writes.push({ filter, update })

        return { matchedCount: matched }
      },
    }),
  }),
})

test('persists template attribution on the owned Bot and fails when destination is missing', async () => {
  writes.length = 0
  const source = { application: 'nuphos-template', templateId: 'desk', version: '1.0.0' }
  const requirements = [{ provider: 'github', required: true, reason: 'Read issues' }]
  const manifest = botBundleSchema.parse({
    format: 'nuphos-bot-bundle',
    version: 1,
    source,
    requirements,
    bots: [{ key: 'desk', name: 'Desk' }],
  })
  const owner = { userId: 'alice', teamId: 'team', runtimeId: 'runtime', agentRuntime: 'codex' }
  const batch = newImportBatch(owner, 'digest', manifest)
  const item = batch.items[0]!

  await saveTemplateOrigin(batch, item)
  expect(writes[0]).toEqual({
    filter: { sessionId: item.sessionId, userId: 'alice', teamId: 'team' },
    update: { $set: { botTemplate: { templateId: 'desk', version: '1.0.0', requirements } } },
  })
  matched = 0
  await expect(saveTemplateOrigin(batch, item)).rejects.toThrow('Template destination not found')
  matched = 1
})
