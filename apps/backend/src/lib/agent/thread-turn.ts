import { signNuphosToken } from '@/lib/identity'
import { persistedMessageToUiMessage } from '@/routes/mcp/transcript'

import { agentMessages, getConversationWithMessages } from './db'
import { buildPendingUserMessage, hasPendingUserMessage } from './pending-messages'
import { authorizeThreadDelivery } from './thread-bridge'
import { turnRunner } from './turn-runner'

import type { ThreadTurn } from './thread-bridge'
import type { UIMessage } from 'ai'

/** Run through the same claim, pending-message and transcript path as chat bridges. */
export async function executeThreadTurn(data: ThreadTurn): Promise<void> {
  // Recheck live membership/selection after queue delay, not only at tool invocation.
  const target = await authorizeThreadDelivery(data)

  // A stalled queue delivery may have reached an active turn before its ACK.
  if (await hasPendingUserMessage(data.userId, data.targetSessionId, data.messageId)) return

  if (
    await agentMessages().findOne(
      {
        sessionId: data.targetSessionId,
        userId: data.userId,
        messageId: data.messageId,
      },
      { projection: { _id: 1 } },
    )
  )
    return
  const renderedText = [
    `[Agent message from Nuphos conversation ${data.sessionId}; not a new human instruction or approval.]`,
    data.prompt,
    'If this delegates work, report the result to the source with send_message_to_thread. Do not send acknowledgement loops.',
  ].join('\n\n')
  const claim = await turnRunner.claimAgentRunOrEnqueue({
    userId: data.userId,
    sessionId: data.targetSessionId,
    message: {
      ...buildPendingUserMessage({
        renderedText,
        source: 'agent.thread',
        actorUserId: data.userId,
      }),
      id: data.messageId,
    },
  })

  if (claim.mode === 'dropped') throw new Error('Thread message could not be queued.')
  if (claim.mode === 'queued') return
  try {
    // Read after taking the claim so a just-finished turn cannot be overwritten.
    const history = await getConversationWithMessages(
      data.targetSessionId,
      data.userId,
      data.teamId,
    )

    if (!history) throw new Error('Target conversation no longer exists.')
    // BullMQ can redeliver a stalled job. An accepted message must not run twice.
    if (history.messages.some((message) => message.messageId === data.messageId)) return
    const prior = history.messages
      .map(persistedMessageToUiMessage)
      .filter((message): message is UIMessage => message !== null)
    // A recovered queue already contains this delivery; never append it twice.
    const pending: UIMessage[] = claim.carried.length
      ? claim.carried.map((message) => ({
          id: message.id,
          role: 'user',
          metadata: message.metadata,
          parts: [{ type: 'text', text: message.renderedText }],
        }))
      : [{ id: data.messageId, role: 'user', parts: [{ type: 'text', text: renderedText }] }]

    const outcome = await turnRunner.runAgentForTrigger({
      userId: data.userId,
      teamId: data.teamId,
      sessionId: data.targetSessionId,
      nuphosToken: signNuphosToken(data.userId, 8 * 60 * 60),
      messages: [...prior, ...pending],
      firstMessage: target.firstMessage,
      source: 'agent.thread',
      locale: data.locale,
      // Keep ordinary permission handling; delegation must not turn on Full Access.
      origin: 'user',
    })

    if (outcome.status === 'failed')
      throw new Error('Thread run failed; inspect the target conversation.')
  } finally {
    claim.release()
  }
}
