import { runtimeAllows } from '../../../lib/runtimeExecution.ts'

import type { Message } from './model'
import type { RuntimeExecution } from '../../../lib/runtimeExecution.ts'

/**
 * How a send leaves the composer. Only an explicit reply (a question id from
 * the reply composer, the chip or a card) answers a question, and never a
 * steer into the running turn or a send with a turn kind (plan approval and
 * the like). Steering is decided exactly as it was before questions existed.
 */
export function routeSend(
  runtimeState: RuntimeExecution | undefined,
  turnKind: Message['turnKind'] | undefined,
  questionId: string | undefined,
): { steer: boolean; decisionReplyTo?: string } {
  const steer =
    runtimeAllows(runtimeState, 'steer') && !runtimeAllows(runtimeState, 'reply') && !turnKind

  return steer || turnKind || !questionId ? { steer } : { steer, decisionReplyTo: questionId }
}
