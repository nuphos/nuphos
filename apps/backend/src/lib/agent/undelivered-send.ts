// A person's send that will not run is never just gone: it stays in its
// conversation, followed by why, for everyone who reads it.
import { randomUUID } from 'node:crypto'

import { logError, logEvent } from '@/lib/observability'

import { channelIdOf, noteReplyFailed } from './channel-wake'
import { appendConversationMessages, getConversationBySessionId } from './db'
import { reopenInputRequest } from './db/pending-decision'
import { systemSender } from './message-metadata'

import type { DeliveredTo } from './conversation-turn'
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

/**
 * The one rule for an accepted message: it runs as a turn of its target, or its
 * sender is told, once, that it did not. A thread message is answered in its
 * sender's thread; a person's send stays in the conversation, with the reason;
 * a channel's wake notice is a line in that channel.
 */
export async function reportUndelivered(
  // No team when the target conversation is gone: the sender's own is the one it sent from.
  data: Omit<DeliveredTo, 'teamId'> & { teamId?: string },
  messages: readonly PendingUserMessage[],
  reason: string,
  /** Why, for a channel's line; none says only that the agent could not reply. */
  error?: unknown,
): Promise<void> {
  for (const message of messages) {
    const senderId = message.metadata?.sourceSessionId
    const channelId = channelIdOf(message)

    // A channel's wake notice is told to the channel: its people see the agent could not reply.
    if (channelId) {
      logEvent('warn', 'agent.channel.wake_undelivered', {
        channel_id: channelId,
        session_id: data.targetSessionId,
        message_id: message.id,
        reason,
      })
      await noteReplyFailed(channelId, data.targetSessionId, error ?? new Error(reason))
      continue
    }
    if (message.chat) await keepUndeliveredSend(data, message, `This message ${reason}`)
    if (message.answers) await reopenUndeliveredAnswer(data, message.answers, reason)
    // Only an agent's message is answered. The answer is Nuphos's own notice,
    // never an agent's, so it is never reported back: threads cannot ping-pong.
    if (message.source !== 'agent.thread' || !senderId) continue
    const failed = (error: unknown) => {
      logError('agent.thread.undelivered_report_failed', error, {
        session_id: data.targetSessionId,
        source_session_id: senderId,
        message_id: message.id,
      })
    }

    try {
      const sender = await getConversationBySessionId(senderId)

      // The same owner and team the delivery was authorized for; an archived one is restored.
      if (
        sender?.userId !== data.userId ||
        !sender.teamId ||
        (data.teamId && sender.teamId !== data.teamId)
      )
        continue
      const excerpt = message.renderedText.slice(0, 200)
      const notice = `Your message to thread ${data.targetSessionId} ${reason} It began: "${excerpt}". Check that thread before resending anything, since work may be partly done. If its agent is unavailable, move it to a running agent (update_thread runtimeId) first.`
      // Not awaited: this turn still holds its own target, and the sender may be busy.
      // Lazy: the turn module reports through this one.
      const { startConversationTurn } = await import('./conversation-turn')
      const { run } = await startConversationTurn(
        {
          ...data,
          teamId: sender.teamId,
          targetSessionId: senderId,
          messageId: randomUUID(),
          locale: data.locale ?? 'en',
        },
        sender,
        notice,
        'agent.resource',
        systemSender('nuphos', 'Nuphos', `/teams/${sender.teamId}/agent/${data.targetSessionId}`),
      )

      run.catch(failed)
    } catch (error) {
      failed(error)
    }
  }
}
