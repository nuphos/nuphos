import { agentConversations, withTeamScope } from './shared'

import type { AgentConversation } from './shared'

export function pickModelFallbackModelId(
  fallback: AgentConversation['modelFallback'] | undefined,
): string | null {
  return fallback?.active ? fallback.toModelId : null
}

// The model id a turn should run on given the sticky fallback: read by
// sessionId alone (the fallback is a property of the conversation, not the
// viewer — shared-conversation turns must resolve the same one). Null =
// unflagged conversation OR the doc has not landed yet; both mean "use the
// primary model" downstream.
export async function getConversationModelFallbackModelId(
  sessionId: string,
): Promise<string | null> {
  const doc = await agentConversations().findOne(
    { sessionId },
    { projection: { _id: 0, modelFallback: 1 } },
  )

  return pickModelFallbackModelId(doc?.modelFallback)
}

// Write-once: the `modelFallback: { $exists: false }` filter is the once-guard,
// so repeated content-filter turns never rewrite firstTriggeredAt. Split from
// the DB call so the update document is unit-testable without a live Mongo.
export function buildModelFallbackMark(
  sessionId: string,
  args: { fromModelId: string; toModelId: string; reason?: 'content-filter' },
  now: Date,
): {
  filter: { sessionId: string; modelFallback: { $exists: false } }
  update: { $set: Required<Pick<AgentConversation, 'modelFallback'>> }
} {
  return {
    filter: { sessionId, modelFallback: { $exists: false } },
    update: {
      $set: {
        modelFallback: {
          active: true,
          reason: args.reason ?? 'content-filter',
          firstTriggeredAt: now,
          fromModelId: args.fromModelId,
          toModelId: args.toModelId,
        },
      },
    },
  }
}

export async function markConversationModelFallbackActive(args: {
  sessionId: string
  teamId: string | undefined
  fromModelId: string
  toModelId: string
  reason?: 'content-filter'
}): Promise<void> {
  const { filter, update } = buildModelFallbackMark(args.sessionId, args, new Date())

  await agentConversations().updateOne(withTeamScope(filter, args.teamId), update)
}
