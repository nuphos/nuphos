// A person's send that will not run is never just gone: it stays in its
// conversation, followed by why, for everyone who reads it.
import { logError, logEvent } from '@/lib/observability'

import { channelIdOf, noteReplyFailed } from './channel-wake'
import { appendConversationMessages } from './db'
import { reopenInputRequest } from './db/pending-decision'
import { systemSender } from './message-metadata'

import type { InputRequest } from './db/pending-decision'
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

const EARLIER_ANSWER = /^> Your earlier answer .*\n\n/

/**
 * A person's answer its agent never read is not kept as given: the question is
 * open again, in the conversation and the Inbox, and its body says why.
 */
export async function reopenUndeliveredAnswer(
  data: { userId: string; targetSessionId: string },
  request: InputRequest,
  reason: string,
): Promise<void> {
  await reopenInputRequest(data.targetSessionId, data.userId, {
    ...request,
    // Only the latest failure is said.
    body: `> Your earlier answer ${reason}\n\n${request.body?.replace(EARLIER_ANSWER, '') ?? ''}`,
    // The queue stores it as JSON.
    askedAt: new Date(request.askedAt),
  }).catch((error: unknown) => {
    logError('agent.decision.reopen_failed', error, { session_id: data.targetSessionId })
  })
}

export const LOST_TURN =
  'was cut off: the runtime restarted during that turn, which may have stopped partway or finished just before.'

/**
 * Keeps a message that will not run where its people see it: a channel's wake
 * notice as that channel's line, a person's send or answer in the conversation.
 */
export async function keepUndelivered(
  data: { userId: string; teamId?: string; targetSessionId: string },
  message: PendingUserMessage,
  reason: string,
  /** Why, for a channel's line; none says only that the agent could not reply. */
  error?: unknown,
): Promise<void> {
  const channelId = channelIdOf(message)

  if (channelId) {
    logEvent('warn', 'agent.channel.wake_undelivered', {
      channel_id: channelId,
      session_id: data.targetSessionId,
      message_id: message.id,
      reason,
    })
    await noteReplyFailed(channelId, data.targetSessionId, error ?? new Error(reason))
  }
  if (message.chat) await keepUndeliveredSend(data, message, `This message ${reason}`)
  if (message.answers) await reopenUndeliveredAnswer(data, message.answers, reason)
}
