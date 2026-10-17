import { isRuntimeRefusal } from '@/lib/claude-code-preview/runtime-refusal'
import { signNuphosToken } from '@/lib/identity'
import { persistedMessageToUiMessage } from '@/routes/mcp/transcript'

import { agentMessages, getConversationWithMessages } from './db'
import { buildPendingUserMessage, hasPendingUserMessage } from './pending-messages'
import { requeueTurnQueue } from './session-released'
import { turnRunner } from './turn-runner'

import type { AgentConversation } from './db'
import type { MessageMetadata } from './message-metadata'
import type { PendingUserMessage } from './pending-messages'
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
 * with the turn's finish reason), 'queued' when it waits behind the turns ahead
 * of it. It runs as its own turn, never folded into another sender's.
 */
export async function startConversationTurn(
  ...[data, target, renderedText, source, metadata]: TurnArgs
): Promise<{ status: 'started' | 'queued'; run: Promise<string | undefined> }> {
  // Also the answer for a redelivery already accepted, not only for a busy target.
  const queued = { status: 'queued' as const, run: Promise.resolve(undefined) }

  // A stalled queue delivery may have reached an active turn before its ACK.
  if (await hasPendingUserMessage(data.userId, data.targetSessionId, data.messageId)) return queued

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
    return queued
  const message = {
    ...buildPendingUserMessage({ renderedText, metadata, source, actorUserId: data.userId }),
    id: data.messageId,
  }
  const claim = await turnRunner.claimAgentRunOrEnqueue({
    userId: data.userId,
    sessionId: data.targetSessionId,
    message,
  })

  if (claim.mode === 'dropped') throw new Error('Thread message could not be queued.')
  if (claim.mode === 'queued') return queued

  const run = async (): Promise<string | undefined> => {
    try {
      // A recovered queue already contains this delivery; never append it twice.
      return await runTurn(data, target, source, claim.carried.length ? claim.carried : [message])
    } finally {
      claim.release()
    }
  }

  return { status: 'started', run: run() }
}

/** Runs a turn for messages delivered to a conversation, after its history. */
export async function runTurn(
  data: Pick<ConversationTurn, 'userId' | 'teamId' | 'targetSessionId'> & { locale?: string },
  target: AgentConversation,
  source: string,
  pending: PendingUserMessage[],
): Promise<string | undefined> {
  // Read after taking the claim so a just-finished turn cannot be overwritten.
  const history = await getConversationWithMessages(data.targetSessionId, data.userId, data.teamId)

  if (!history) throw new Error('Target conversation no longer exists.')
  // BullMQ can redeliver a stalled job. An answered message must not run twice;
  // one after the last reply was accepted by a refused turn and runs again.
  const answered = history.messages.findLastIndex((message) => message.role === 'assistant')
  const ran = new Set(history.messages.slice(0, answered + 1).map((message) => message.messageId))
  const fresh = pending.filter((message) => !ran.has(message.id))
  const [head, ...rest] = fresh

  if (!head) return
  const prior = history.messages
    .filter((message) => !fresh.some((entry) => entry.id === message.messageId))
    .map(persistedMessageToUiMessage)
    .filter((message): message is UIMessage => message !== null)
  const outcome = await turnRunner
    .runAgentForTrigger({
      userId: data.userId,
      teamId: data.teamId,
      sessionId: data.targetSessionId,
      nuphosToken: signNuphosToken(data.userId, 8 * 60 * 60),
      messages: [
        ...prior,
        ...fresh.map((message): UIMessage => ({
          id: message.id,
          role: 'user',
          metadata: message.metadata,
          parts: [{ type: 'text', text: message.renderedText }],
        })),
      ],
      firstMessage: target.firstMessage,
      source,
      ...(data.locale ? { locale: data.locale } : {}),
      // 'user' adds no Full Access default: a thread took its parent's mode at creation.
      origin: source === 'agent.resource' ? 'trigger' : 'user',
      // Not recorded as interrupted: the messages go back on the queue below.
      clientResendsRefusal: true,
    })
    .catch(async (error: unknown) => {
      // The runtime took another turn after the check. Back to the front, retried
      // after a wait rather than on the release that follows.
      if (!isRuntimeRefusal(error)) throw error
      await requeueTurnQueue(data.userId, data.targetSessionId, rest, head)

      return null
    })

  if (!outcome) return

  if (outcome.status === 'failed')
    throw new Error('Thread run failed; inspect the target conversation.')

  return outcome.finishReason
}
