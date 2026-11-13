import { queuedAnswers } from '@/lib/agent/pending-queue'
import { AppError } from '@/lib/errors'

import type { AgentChatBody } from './types'
import type { AgentConversation } from '@/lib/agent/db'

/** The question a Desktop message answers, when it names one the resolve route would accept. */
export function decisionReplyOf(body: Pick<AgentChatBody, 'decisionReplyTo'>): string | undefined {
  const id = body.decisionReplyTo

  return typeof id === 'string' && id.length > 0 && id.length <= 200 ? id : undefined
}

type Asked = Pick<AgentConversation, 'userId' | 'sessionId' | 'inputRequests'>

/**
 * The open questions a queued message already answers. They wait on no one,
 * so the Inbox stops asking while the answer waits behind a running turn. Read
 * from the queue itself, so a message taken back, dropped or never queued
 * leaves its question open again.
 */
export async function answeringIds(conversation: Asked): Promise<ReadonlySet<string>> {
  const asks = Boolean(conversation.inputRequests?.some((request) => request.status === 'open'))

  if (!asks) return new Set()

  return new Set((await queuedAnswers(conversation.userId, conversation.sessionId)).keys())
}

/**
 * A question takes one answer. A second one (a repeated click, another option)
 * is refused while the first waits in the queue. Once answered the question is
 * off the list, like a card this conversation never listed: the turn takes the
 * message as it is. A resent copy of the same message is not a second answer.
 */
export async function assertDecisionUnanswered(
  conversation: Asked,
  decisionId: string,
  messageId: string,
): Promise<void> {
  const request = conversation.inputRequests?.find((entry) => entry.id === decisionId)
  const waiting = request
    ? (await queuedAnswers(conversation.userId, conversation.sessionId)).get(decisionId)
    : undefined

  if (waiting && waiting !== messageId)
    throw new AppError(409, 'decision_already_answered', 'This question was already answered')
}
