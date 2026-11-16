// An answer its agent could not run (out of usage, signed out, offline) is kept,
// not dropped: the question stays answered, and the answer reaches the agent
// once it can run, or the agent the conversation moves to. Delivery is in
// deliver-waiting-answers.ts.
import { claudeNotice, turnFailureCause } from '@/lib/claude-code-preview/openab-acp-errors'
import { plainTurnFailure } from '@/lib/claude-code-preview/plain-failure'
import { logError } from '@/lib/observability'

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

/** Why a turn failed, on one line: a plain sentence when the user can act on it, else the agent's words. */
export const failureLine = (error: unknown) =>
  (
    plainTurnFailure(error) ??
    claudeNotice(error) ??
    (error instanceof Error ? error.message : String(error))
  ).replace(/\s+/g, ' ')

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
