import { randomUUID } from 'node:crypto'

import { isRuntimeRefusal } from '@/lib/claude-code-preview/runtime-refusal'
import { AppError } from '@/lib/errors'
import { signNuphosToken } from '@/lib/identity'
import { logError } from '@/lib/observability'
import { persistedMessageToUiMessage } from '@/routes/mcp/transcript'

import { agentMessages, getConversationBySessionId } from './db'
import { channelIdOf, withChannelPosts } from './channel-wake'
import { systemSender } from './message-metadata'
import { buildPendingUserMessage, hasPendingUserMessage } from './pending-messages'
import { requeueTurnQueue } from './session-released'
import { recordFailedFires } from './trigger-failed-runs'
import { recordFiresRan } from './trigger-missed-runs'
import { reconnecting } from './turn-offline'
import { readTurnHistory } from './turn-history'
import { turnRunner } from './turn-runner'
import { keepUndelivered, LOST_TURN, runtimeRestarted } from './undelivered-send'
import { failureLine, keepAnswersThatWait } from './waiting-answers'

import type { AgentConversation } from './db'
import type { ConversationTriggerRun } from './conversation-trigger-run'
import type { MessageMetadata } from './message-metadata'
import type { PendingUserMessage } from './pending-messages'
import type { UIMessage } from 'ai'

type ConversationTurn = {
  userId: string
  teamId: string
  targetSessionId: string
  messageId: string
  locale: string
  /** The Trigger fire this turn answers, when it came from one. */
  trigger?: ConversationTriggerRun
  /** The question this message answers, when it carries a person's answer to one. */
  answers?: NonNullable<PendingUserMessage['answers']>
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
  await startConversationTurn(...args).then(({ run }) => run)
}

/**
 * Hands the message to the target: 'started' when it took the run (`run` settles
 * with the turn's finish reason), 'queued' when it waits behind the turns ahead
 * of it. Messages one sender left waiting run together in one turn, never folded into another
 * sender's.
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
      { sessionId: data.targetSessionId, userId: data.userId, messageId: data.messageId },
      { projection: { _id: 1 } },
    )
  )
    return queued
  const message = {
    ...buildPendingUserMessage({ renderedText, metadata, source, actorUserId: data.userId }),
    id: data.messageId,
    ...(data.answers ? { answers: data.answers } : {}),
  }
  const claim = await turnRunner.claimAgentRunOrEnqueue({
    userId: data.userId,
    sessionId: data.targetSessionId,
    message,
  })

  if (claim.mode === 'dropped')
    throw new AppError(429, 'conversation_queue_unavailable', 'Thread message could not be queued.')
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

type DeliveredTo = Pick<ConversationTurn, 'userId' | 'teamId' | 'targetSessionId'> & {
  locale?: string
}

/**
 * Runs a turn for messages delivered to a conversation, after its history. A
 * thread message it takes and cannot run is reported to its sender.
 */
export async function runTurn(
  data: DeliveredTo & Pick<ConversationTurn, 'trigger'>,
  target: AgentConversation,
  source: string,
  pending: PendingUserMessage[],
): Promise<string | undefined> {
  let taken = pending
  let unmarkRead: (() => Promise<void>) | undefined

  try {
    // Read after taking the claim so a just-finished turn cannot be overwritten.
    const history = await readTurnHistory(data, pending, source)

    if (!history) throw new Error('Target conversation no longer exists.')
    // BullMQ can redeliver a stalled job: a message a turn already ran must not run
    // twice. One a refused turn stored and handed back runs again.
    const { messages: fresh, markRead } = await withChannelPosts(
      data.targetSessionId,
      data.userId,
      pending.filter((message) => !history.answered.has(message.id)),
    )
    const [head, ...rest] = fresh

    taken = fresh
    if (!head) return
    // Read as the turn sees them, so its channel_read goes on from there.
    unmarkRead = await markRead()
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
        // The channels this turn answers, where a question was answered too: they show it typing.
        channelIds: fresh.flatMap((m) => channelIdOf(m) ?? m.answers?.channelId ?? []),
        ...(fresh.every((message) => channelIdOf(message)) ? { channelWoken: true } : {}),
        // Not recorded as interrupted: the messages go back on the queue below.
        clientResendsRefusal: true,
        ...(data.trigger ? { trigger: data.trigger } : {}),
      })
      .catch(async (error: unknown) => {
        // The runtime took another turn after the check, its computer is reconnecting, or
        // this replica is draining. Back to the front, retried after a wait rather than on
        // the release that follows; a draining replica starts nothing, so another one does.
        const offline = reconnecting(error, head)
        const draining = error instanceof AppError && error.code === 'server_draining'

        if (!offline && !draining && !isRuntimeRefusal(error)) throw error
        taken = []
        await unmarkRead?.()
        await requeueTurnQueue(data.userId, data.targetSessionId, rest, {
          ...head,
          // Only an unbroken run of offline tries counts toward the grace.
          offlineSince: offline ? (head.offlineSince ?? new Date().toISOString()) : undefined,
        })

        return null
      })

    if (!outcome) return

    if (outcome.status === 'failed')
      throw new Error('Thread run failed; inspect the target conversation.')
    await recordFiresRan(fresh)
    // Not awaited: it waits for the computer to come back, which may be never,
    // and this turn's claim must not wait with it.
    if (outcome.finishReason === 'connection-lost') void reportIfRestarted(data, fresh, unmarkRead)

    return outcome.finishReason
  } catch (error) {
    // Not run, or failed: a later notice shows the same posts again.
    await unmarkRead?.()
    await reportUndelivered(
      data,
      await keepAnswersThatWait(target, taken, error),
      `did not run: ${failureLine(error)}`,
      error,
    )
    throw error
  }
}

async function reportIfRestarted(
  data: DeliveredTo,
  messages: readonly PendingUserMessage[],
  unmarkRead: (() => Promise<void>) | undefined,
): Promise<void> {
  try {
    if (!(await runtimeRestarted(data))) return
    // A channel's wake it cut off was never answered: its posts go back to unread and the
    // wake to the queue, as after a refused turn. One a later wake read past finds nothing.
    await unmarkRead?.()
    const [wake, ...wakes] = messages.filter((message) => channelIdOf(message))

    await requeueTurnQueue(data.userId, data.targetSessionId, wakes, wake)
    await reportUndelivered(
      data,
      messages.filter((message) => !channelIdOf(message)),
      LOST_TURN,
    )
  } catch (error) {
    logError('agent.thread.lost_turn_check_failed', error, { session_id: data.targetSessionId })
  }
}

/**
 * The one rule for an accepted message: it runs as a turn of its target, or its
 * sender is told, once, that it did not. A thread message is answered in its
 * sender's thread; a person's send stays in the conversation, with the reason;
 * a channel's wake notice is a line in that channel; a Trigger's fire is
 * recorded on the Trigger, which has no sender to tell.
 */
export async function reportUndelivered(
  // No team when the target conversation is gone: the sender's own is the one it sent from.
  data: Omit<DeliveredTo, 'teamId'> & { teamId?: string },
  messages: readonly PendingUserMessage[],
  reason: string,
  error?: unknown,
): Promise<void> {
  await recordFailedFires(error, messages)
  for (const message of messages) {
    const senderId = message.metadata?.sourceSessionId

    await keepUndelivered(data, message, reason, error)
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
