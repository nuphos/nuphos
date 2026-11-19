import { agentConversations } from '@/lib/agent/db'

import type { ImportBatch, ImportItem } from './batch'

/** Attribution only: a source label is not proof that an uploaded bundle is official. */
export async function saveTemplateOrigin(batch: ImportBatch, item: ImportItem) {
  const source = batch.manifest.source

  if (source.application !== 'nuphos-template') return
  const result = await agentConversations().updateOne(
    { sessionId: item.sessionId, userId: batch.userId, teamId: batch.teamId },
    {
      $set: {
        botTemplate: {
          templateId: source.templateId,
          version: source.version,
          requirements: batch.manifest.requirements ?? [],
        },
      },
    },
  )

  if (!result.matchedCount) throw new Error('Template destination not found')
}
