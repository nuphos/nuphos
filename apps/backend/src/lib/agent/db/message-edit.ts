import { pushTimelineEvent } from './participants'
import { agentConversations } from './shared'

/** Link a stored fork once, whether it copied the whole chat or reran an edit. */
export async function recordMessageEditedInFork(
  sessionId: string,
  actorId: string,
  forkSessionId: string,
  kind: 'message_edited' | 'conversation_forked' = 'message_edited',
): Promise<void> {
  await agentConversations().updateOne(
    { sessionId, 'timelineEvents.forkSessionId': { $ne: forkSessionId } },
    {
      $push: pushTimelineEvent({
        kind,
        at: new Date(),
        actorId,
        forkSessionId,
      }),
    },
  )
}
