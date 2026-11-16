// An answer its agent could not run (out of usage, signed out, offline) is kept,
// not dropped: the question stays answered, and the answer reaches the agent
// once it can run, or the agent the conversation moves to. Every trigger calls
// deliverWaitingAnswers; whoever takes an answer off the list delivers it, once.
import { randomUUID } from 'node:crypto'

import { claudeNotice, turnFailureCause } from '@/lib/claude-code-preview/openab-acp-errors'
import { logError } from '@/lib/observability'

import { getConversationBySessionId } from './db'
import { agentConversations } from './db/shared'

import type { AgentConversation } from './db'
import type { InputRequest } from './db/pending-decision'
import type { PendingUserMessage } from './pending-message-types'
import type { TurnFailureCause } from '@/lib/claude-code-preview/openab-acp-errors'

export type WaitingAnswer = {
  requestId: string
  cause: Exclude<TurnFailureCause, 'other'>
  /** When an agent out of usage gets it back, when its reading says. */
  resetsAt?: string
  at: Date
  message: PendingUserMessage & { answers: InputRequest }
}

export async function keepWaitingAnswer(
  sessionId: string,
  message: WaitingAnswer['message'],
  cause: WaitingAnswer['cause'],
  resetsAt?: string,
): Promise<void> {
  const requestId = message.answers.id
  const entry: WaitingAnswer = {
    requestId,
    cause,
    ...(resetsAt ? { resetsAt } : {}),
    at: new Date(),
    message,
  }

  await agentConversations().updateOne(
    { sessionId, 'waitingAnswers.requestId': { $ne: requestId } },
    { $push: { waitingAnswers: entry } },
  )
  if (resetsAt) {
    const { enqueueAnswerDelivery } = await import('./thread-queue')

    await enqueueAnswerDelivery(sessionId, requestId, resetsAt).catch((error: unknown) => {
      logError('agent.waiting_answer.schedule_failed', error, { session_id: sessionId })
    })
  }
}

/**
 * After a failed turn: when its agent was the cause, the answers it carried
 * wait for that agent, with when its usage is back if it ran out. Returns the
 * messages still to report.
 */
export async function keepAnswersThatWait(
  target: AgentConversation,
  messages: PendingUserMessage[],
  error: unknown,
): Promise<PendingUserMessage[]> {
  const cause = turnFailureCause(error)
  const answers = cause === 'other' ? [] : messages.filter((message) => message.answers)

  if (cause === 'other' || !answers.length) return messages
  const { teamId, userId, runtimeId } = target
  const { usageResetsAt } = await import('@/lib/claude-code-preview/runtime-catalog')
  const resetsAt =
    cause === 'usage_limit' && teamId && runtimeId
      ? await usageResetsAt(teamId, userId, runtimeId).catch(() => undefined)
      : undefined

  for (const message of answers)
    await keepWaitingAnswer(
      target.sessionId,
      { ...message, answers: message.answers! },
      cause,
      resetsAt,
    )

  return messages.filter((message) => !answers.includes(message))
}

/** Why a turn failed, on one line, in the agent's own words where it gave them. */
export const failureLine = (error: unknown) =>
  (claudeNotice(error) ?? (error instanceof Error ? error.message : String(error))).replace(
    /\s+/g,
    ' ',
  )

/** Sends each waiting answer to the conversation's agent, now. Never throws. */
export async function deliverWaitingAnswers(sessionId: string): Promise<void> {
  try {
    const conversation = await getConversationBySessionId(sessionId)

    if (!conversation?.teamId || !conversation.waitingAnswers?.length) return
    const { startConversationTurn } = await import('./conversation-turn')

    for (const { requestId, message, cause, resetsAt } of conversation.waitingAnswers) {
      const taken = await agentConversations().updateOne(
        { sessionId, 'waitingAnswers.requestId': requestId },
        { $pull: { waitingAnswers: { requestId } } },
      )

      if (!taken.modifiedCount) continue
      // A turn that fails again for its agent keeps the answer waiting once more.
      await startConversationTurn(
        {
          userId: conversation.userId,
          teamId: conversation.teamId,
          targetSessionId: sessionId,
          messageId: randomUUID(),
          locale: conversation.metadata?.locale ?? 'en-US',
          answers: message.answers,
        },
        conversation,
        message.renderedText,
        'agent.resource',
        message.metadata!,
      ).then(
        ({ run }) => {
          run.catch(() => {})
        },
        // Not taken by a turn at all: back on the list for the next trigger.
        () => keepWaitingAnswer(sessionId, message, cause, resetsAt),
      )
    }
  } catch (error) {
    logError('agent.waiting_answer.deliver_failed', error, { session_id: sessionId })
  }
}

/** The waiting answers of every conversation on these agents, now one of them is back. */
export async function deliverWaitingAnswersOn(filter: Record<string, unknown>): Promise<void> {
  try {
    const waiting = await agentConversations()
      .find({ ...filter, 'waitingAnswers.0': { $exists: true } }, { projection: { sessionId: 1 } })
      .limit(500)
      .toArray()

    for (const { sessionId } of waiting) await deliverWaitingAnswers(sessionId)
  } catch (error) {
    logError('agent.waiting_answer.deliver_failed', error, {})
  }
}

/** A computer reconnected: every agent on it (`local_<owner>_<device>…`) can run again. */
export const deliverWaitingAnswersOnDevice = (userId: string, deviceId: string) =>
  deliverWaitingAnswersOn({ runtimeId: { $regex: `^local_${userId}_${deviceId}(_|$)` } })

/** The line a client shows under the question: answered, and what it waits for. */
export function waitingNote(waiting: Pick<WaitingAnswer, 'cause' | 'resetsAt'>, agent: string) {
  const until = waiting.resetsAt
    ? ` until ${new Date(waiting.resetsAt).toISOString().slice(11, 16)} UTC`
    : ''
  const why =
    waiting.cause === 'usage_limit'
      ? `out of usage${until}`
      : waiting.cause === 'auth'
        ? 'signed out'
        : 'offline'

  return `Answered · waiting for ${agent} (${why})`
}
