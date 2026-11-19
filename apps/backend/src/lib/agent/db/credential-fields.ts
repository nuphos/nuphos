import { recordAgentEvent } from './events'
import { agentConversations, withTeamScope } from './shared'

import type { AgentConversation, AgentCredentialAccess } from './shared'

/**
 * Sets only the named selection fields, so a concurrent edit to the rest of the
 * selection (another category, local devices) is not overwritten.
 */
export async function setConversationCredentialFields(
  sessionId: string,
  userId: string,
  teamId: string,
  fields: Partial<AgentCredentialAccess>,
): Promise<AgentConversation | null> {
  const now = new Date()
  const result = await agentConversations().findOneAndUpdate(
    withTeamScope({ sessionId, userId }, teamId),
    {
      $set: {
        ...Object.fromEntries(
          Object.entries(fields).map(([key, ids]) => [`credentialAccess.${key}`, ids]),
        ),
        'credentialAccess.updatedAt': now,
        'credentialAccess.updatedBy': userId,
        lastActiveAt: now,
      },
    },
    { returnDocument: 'after' },
  )

  if (result) {
    recordAgentEvent({
      conversationId: sessionId,
      event: 'credentials.updated',
      userId,
      data: fields,
    })
  }

  return result
}
