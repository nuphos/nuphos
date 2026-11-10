// A person's send that will not run is never just gone: it stays in its
// conversation, followed by why, for everyone who reads it.
import { logError } from '@/lib/observability'

import { appendConversationMessages } from './db'
import { systemSender } from './message-metadata'

import type { PendingUserMessage } from './pending-messages'

/** Stores a person's send that will not run, and why, where everyone in the conversation sees it. */
export async function keepUndeliveredSend(
  data: { userId: string; teamId?: string; targetSessionId: string },
  message: PendingUserMessage,
  notice: string,
): Promise<void> {
  if (!data.teamId || !message.chat) return
  await appendConversationMessages({
    sessionId: data.targetSessionId,
    userId: data.userId,
    teamId: data.teamId,
    messages: [
      {
        id: message.chat.message.id,
        role: 'user',
        parts: message.chat.message.parts,
        ...(message.metadata ? { metadata: message.metadata } : {}),
      },
      // Nuphos's notice, shown as its event line, never as the agent's reply.
      {
        id: `${message.id}-undelivered`,
        role: 'user',
        parts: [{ type: 'text', text: notice }],
        metadata: systemSender('nuphos', 'Nuphos'),
      },
    ],
  }).catch((error: unknown) => {
    logError('agent.chat.undelivered_store_failed', error, {
      session_id: data.targetSessionId,
      message_id: message.id,
    })
  })
}
