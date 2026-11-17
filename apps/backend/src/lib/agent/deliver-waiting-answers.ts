// Every trigger that may let an agent run again calls deliverWaitingAnswers;
// whoever takes an answer off the list delivers it, once.
import { randomUUID } from 'node:crypto'

import { logError } from '@/lib/observability'

import { getConversationBySessionId } from './db'
import { agentConversations } from './db/shared'
import { keepWaitingAnswer } from './waiting-answers'

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

/** The agents on a computer (`local_<owner>_<device>…`). */
export function onDevice(userId: string, deviceId: string) {
  const runtimeId = `local_${userId}_${deviceId}`
  // A plain prefix, so the `runtimeId` index bounds the read to this computer.
  const prefix = runtimeId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

  return { $or: [{ runtimeId }, { runtimeId: { $regex: `^${prefix}_` } }] }
}
