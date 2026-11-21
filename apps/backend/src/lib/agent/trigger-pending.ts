import { ObjectId } from 'mongodb'

import { getConversationBySessionId } from './db'
import { agentTriggers } from './trigger-db'
import { triggerIdOf } from './trigger-missed-runs'

import type { PendingUserMessage } from './pending-messages'

type Deps = {
  archived: (sessionId: string) => Promise<boolean>
  live: (triggerId: string, sessionId: string) => Promise<boolean>
}

const deps: Deps = {
  archived: async (sessionId) => Boolean((await getConversationBySessionId(sessionId))?.archivedAt),
  live: async (triggerId, sessionId) =>
    Boolean(
      await agentTriggers().findOne(
        {
          _id: new ObjectId(triggerId),
          targetSessionId: sessionId,
          enabled: true,
        },
        { projection: { _id: 1 } },
      ),
    ),
}

/** Drop stale Trigger deliveries without affecting human or other resource messages. */
export async function liveTriggerMessages(
  sessionId: string,
  messages: PendingUserMessage[],
  check: Deps = deps,
): Promise<PendingUserMessage[]> {
  if (!messages.some((message) => triggerIdOf(message))) return messages
  const archived = await check.archived(sessionId)
  const kept: PendingUserMessage[] = []

  for (const message of messages) {
    const id = triggerIdOf(message)

    if (!id || (!archived && (await check.live(id, sessionId)))) kept.push(message)
  }

  return kept
}
