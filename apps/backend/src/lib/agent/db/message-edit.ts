import { pushTimelineEvent } from './participants'
import { agentConversations } from './shared'

/**
 * Leave a line in the conversation that one of its messages was edited and ran
 * again in `forkSessionId`, so whoever opens it can follow the edit. Once per
 * fork: a retried call adds nothing twice.
 */
export async function recordMessageEditedInFork(
  sessionId: string,
  actorId: string,
  forkSessionId: string,
): Promise<void> {
  await agentConversations().updateOne(
    { sessionId, 'timelineEvents.forkSessionId': { $ne: forkSessionId } },
    {
      $push: pushTimelineEvent({
        kind: 'message_edited',
        at: new Date(),
        actorId,
        forkSessionId,
      }),
    },
  )
}
