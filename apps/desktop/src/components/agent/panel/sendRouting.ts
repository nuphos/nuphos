import { runtimeAllows } from '../../../lib/runtimeExecution.ts'

import type { Message } from './model'
import type { RuntimeExecution } from '../../../lib/runtimeExecution.ts'

/**
 * How a send leaves the composer. Only an explicit reply (a question id from
 * the reply composer, the chip or a card) answers a question, and never a
 * steer into the running turn or a send with a turn kind (plan approval and
 * the like). Steering is decided exactly as it was before questions existed,
 * except for a send that can only be an answer (`answering`, the Inbox): it
 * waits behind the running turn with its question, so the question resolves.
 */
export function routeSend(
  runtimeState: RuntimeExecution | undefined,
  turnKind: Message['turnKind'] | undefined,
  questionId: string | undefined,
  answering = false,
): { steer: boolean; decisionReplyTo?: string } {
  const steer =
    runtimeAllows(runtimeState, 'steer') &&
    !runtimeAllows(runtimeState, 'reply') &&
    !turnKind &&
    !(answering && questionId)

  return steer || turnKind || !questionId ? { steer } : { steer, decisionReplyTo: questionId }
}
