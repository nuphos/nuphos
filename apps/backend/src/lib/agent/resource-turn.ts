import { executeConversationTurn } from './conversation-turn'
import { systemSender } from './message-metadata'
import { authorizedResourceTurn } from './resource-webhook'
import { refreshSessionResource } from './session-resources'

import type { ResourceTurn } from './resource-webhook'

export async function executeResourceTurn(data: ResourceTurn) {
  const authorized = await authorizedResourceTurn(data)

  if (!authorized) return
  const { conversation } = authorized
  const resource = await refreshSessionResource(conversation, authorized.resource)

  await executeConversationTurn(
    {
      userId: conversation.userId,
      teamId: conversation.teamId!,
      targetSessionId: data.sessionId,
      messageId: data.messageId,
      locale: conversation.metadata?.locale ?? 'en-US',
    },
    conversation,
    data.summary,
    'agent.resource',
    systemSender('github', 'GitHub', resource.url),
  )
}
