import { randomUUID } from 'node:crypto'

import { outOfUsageUntilReset, refusedForNow } from '@/lib/claude-code-preview/runtime-refusal'
import { AppError } from '@/lib/errors'
import { signNuphosToken } from '@/lib/identity'
import { logError } from '@/lib/observability'
import { persistedMessageToUiMessage } from '@/routes/mcp/transcript'

import { channelIdOf, remindUnanswered, withChannelPosts } from './channel-wake'
import { agentMessages, getConversationBySessionId } from './db'
import { systemSender } from './message-metadata'
import { buildPendingUserMessage, hasPendingUserMessage } from './pending-messages'
import { requeueTurnQueue } from './session-released'
import { noteReplyFailed, usageResetsAtOf } from './reply-failed'
import { recordFailedFires } from './trigger-failed-runs'
import { recordFiresRan, triggerIdOf } from './trigger-missed-runs'
import { liveTriggerMessages } from './trigger-pending'
import { readTurnHistory } from './turn-history'
import { reconnecting, undeliveredLead } from './turn-offline'
import { turnRunner } from './turn-runner'
import { keepUndelivered, LOST_TURN, runtimeRestarted } from './undelivered-send'
import { failureLine, keepAnswersThatWait } from './waiting-answers'

import type { ConversationTriggerRun } from './conversation-trigger-run'
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
 * of it. Waiting messages run together in one turn, whoever sent them; an app
 * send still runs alone.
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
  let started = false
  let unmarkRead: (() => Promise<void>) | undefined

  try {
    pending = await liveTriggerMessages(data.targetSessionId, pending)
    taken = pending
    if (pending.length === 0) return
    const history = await readTurnHistory(data, pending, source)

    if (!history) throw new Error('Target conversation no longer exists.')
    const { messages: fresh, markRead } = await withChannelPosts(
      data.targetSessionId,
      data.userId,
      pending.filter((message) => !history.answered.has(message.id)),
    )
    const [head, ...rest] = fresh

    taken = fresh
    if (!head) return
    unmarkRead = await markRead()
    const prior = history.messages
      .filter((message) => !fresh.some((entry) => entry.id === message.messageId))
      .map(persistedMessageToUiMessage)
      .filter((message): message is UIMessage => message !== null)

    started = true
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
        clientResendsRefusal: true,
        // An answer keeps its own wait, with its question (#3055).
        ...(fresh.some((message) => message.answers) ? {} : { waitsOutUsage: true }),
        ...(data.trigger ? { trigger: data.trigger } : {}),
      })
      .catch(async (error: unknown) => {
        // Requeue transient refusals after a delay. Another replica handles draining.
        const offline = reconnecting(error, head)
        const draining = error instanceof AppError && error.code === 'server_draining'
        const limited = outOfUsageUntilReset(error) && !fresh.some((message) => message.answers)
        // Only an unbroken run of offline tries counts; out of usage waits for its reset.
        const offlineSince = offline ? (head.offlineSince ?? new Date().toISOString()) : undefined
        const requeued = { ...head, offlineSince }
        const usage = limited && { until: await usageResetsAtOf(target).catch(() => undefined) }

        if (!offline && !draining && !limited && !refusedForNow(error)) throw error
        taken = []
        await unmarkRead?.()
        await requeueTurnQueue(data.userId, data.targetSessionId, rest, requeued, usage)
        // A channel that woke it says why, once per post, however often it retries.
        if (limited)
          for (const channelId of new Set(fresh.flatMap((m) => channelIdOf(m) ?? [])))
            await noteReplyFailed(channelId, data.targetSessionId, error)

        return null
      })

    if (!outcome) return
    if (outcome.status === 'failed')
      throw new Error('Thread run failed; inspect the target conversation.')
    await recordFiresRan(fresh)
    await remindUnanswered(target, fresh, outcome.finishReason, startConversationTurn)
    if (outcome.finishReason === 'connection-lost') void reportIfRestarted(data, fresh, unmarkRead)

    return outcome.finishReason
  } catch (error) {
    await unmarkRead?.()
    await reportUndelivered(
      data,
      await keepAnswersThatWait(target, taken, error),
      `${undeliveredLead(source, started, error)}: ${failureLine(error)}`,
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
    // A wake or a Trigger's fire it cut off has nobody to tell (#5370): it is queued again.
    await unmarkRead?.()
    const unanswered = (m: PendingUserMessage) => channelIdOf(m) ?? triggerIdOf(m)
    const [head, ...rest] = messages.filter(unanswered)

    await requeueTurnQueue(data.userId, data.targetSessionId, rest, head)
    // The runtime took the turn, so an answer in it was delivered: it stays answered (#5109).
    await reportUndelivered(
      data,
      messages.filter((message) => !unanswered(message) && !message.answers),
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
      const notice = `Your message to thread ${data.targetSessionId} ${reason} It began: "${excerpt}". Check that thread before resending anything, since work may be partly done. If its agent is unavailable, move it to a running agent (update_task runtimeId) first.`
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
