import { signNuphosToken } from '@/lib/identity'
import { persistedMessageToUiMessage } from '@/routes/mcp/transcript'

import { agentMessages, getConversationWithMessages } from './db'
import { buildPendingUserMessage, hasPendingUserMessage } from './pending-messages'
import { turnRunner } from './turn-runner'

import type { AgentConversation } from './db'
import type { MessageMetadata } from './message-metadata'
import type { UIMessage } from 'ai'

type ConversationTurn = {
  userId: string
  teamId: string
  targetSessionId: string
  messageId: string
  locale: string
}

type TurnArgs = [
  data: ConversationTurn,
  target: AgentConversation,
  renderedText: string,
  source: 'agent.thread' | 'agent.resource',
  metadata: MessageMetadata,
]

/** Shared durable delivery path for agent messages and authenticated resource events. */
export async function executeConversationTurn(...args: TurnArgs): Promise<void> {
  const { run } = await startConversationTurn(...args)

  await run
}

/**
 * Hands the message to the target: 'started' when it took the run (`run` settles
 * with the turn's finish reason), 'delivered' when it went to the target's active
 * turn instead.
 */
export async function startConversationTurn(
  ...[data, target, renderedText, source, metadata]: TurnArgs
): Promise<{ status: 'started' | 'delivered'; run: Promise<string | undefined> }> {
  // Also the answer for a redelivery already accepted, not only for a busy target.
  const delivered = { status: 'delivered' as const, run: Promise.resolve(undefined) }

  // A stalled queue delivery may have reached an active turn before its ACK.
  if (await hasPendingUserMessage(data.userId, data.targetSessionId, data.messageId))
    return delivered

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
    return delivered
  const claim = await turnRunner.claimAgentRunOrEnqueue({
    userId: data.userId,
    sessionId: data.targetSessionId,
    message: {
      ...buildPendingUserMessage({
        renderedText,
        metadata,
        source,
        actorUserId: data.userId,
      }),
      id: data.messageId,
    },
  })

  if (claim.mode === 'dropped') throw new Error('Thread message could not be queued.')
  if (claim.mode === 'queued') return delivered

  const run = async (): Promise<string | undefined> => {
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
        : [
            {
              id: data.messageId,
              role: 'user',
              metadata,
              parts: [{ type: 'text', text: renderedText }],
            },
          ]

      const outcome = await turnRunner.runAgentForTrigger({
        userId: data.userId,
        teamId: data.teamId,
        sessionId: data.targetSessionId,
        nuphosToken: signNuphosToken(data.userId, 8 * 60 * 60),
        messages: [...prior, ...pending],
        firstMessage: target.firstMessage,
        source,
        locale: data.locale,
        // 'user' adds no Full Access default: a thread took its parent's mode at creation.
        origin: source === 'agent.resource' ? 'trigger' : 'user',
      })

      if (outcome.status === 'failed')
        throw new Error('Thread run failed; inspect the target conversation.')

      return outcome.finishReason
    } finally {
      claim.release()
    }
  }

  return { status: 'started', run: run() }
}
