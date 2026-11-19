import { executeConversationTurn } from './conversation-turn'
import { relatedQuestionsNote } from './db/pending-decision'
import { systemSender } from './message-metadata'
import { authorizedResourceTurn } from './resource-webhook'

import type { ResourceTurn } from './resource-webhook'

export async function executeResourceTurn(data: ResourceTurn) {
  const authorized = await authorizedResourceTurn(data)

  if (!authorized) return
  // The webhook already stored the state and health this event changed, so the
  // wakeup reads nothing more from GitHub and can't be lost to a failed read.
  const { conversation, resource } = authorized

  await executeConversationTurn(
    {
      userId: conversation.userId,
      teamId: conversation.teamId!,
      targetSessionId: data.sessionId,
      messageId: data.messageId,
      locale: conversation.metadata?.locale ?? 'en-US',
    },
    conversation,
    data.summary + relatedQuestionsNote(conversation, authorized.resource.id, 'resource'),
    'agent.resource',
    systemSender('github', 'GitHub', resource.url),
  )
}
